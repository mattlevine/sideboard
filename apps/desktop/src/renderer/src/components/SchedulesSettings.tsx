import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentKind,
  Autonomy,
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduleWhen,
  ThinkingEffort,
  Thread,
  ThreadAttachment,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import {
  applyAutocomplete,
  autocompleteItemsFromQuery,
  ComposerAutocomplete,
  consumeAutocompleteKeyDown,
  getAutocompleteQuery,
  type AutocompleteItem,
  type AutocompleteSkill,
} from './ComposerAutocomplete';
import {
  ComposerAttachmentChips,
  ComposerOptionsToolbar,
  type ComposerDraftOptions,
} from './ComposerOptionsToolbar';
import { DictationMicButton } from './DictationMicButton';
import { DictationPermissionDialog } from './DictationPermissionDialog';
import {
  absolutePathsFromFiles,
  buffersFromFiles,
  canAcceptComposerFileDrop,
  preventComposerFileDrag,
  snapshotComposerDrop,
} from '../lib/composer-file-drop';
import { GLOBAL_WORKSPACE_ID } from '../lib/global-workspace';
import { attachmentsFromLargePaste } from '../lib/paste-attachment';
import { worktreePathToFile } from '../lib/sideboard-file-drag';
import { useSpeechDictation } from '../lib/use-speech-dictation';
import {
  loadOrchestratorDefaults,
  type ThreadDefaults,
} from '../lib/thread-defaults';

type CadenceKind = ScheduleWhen['kind'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultOnceLocal(): string {
  return toDatetimeLocal(new Date(Date.now() + 60 * 60_000).toISOString());
}

function formatWhen(when: ScheduleWhen): string {
  if (when.kind === 'once') {
    const d = new Date(when.at);
    return Number.isNaN(d.getTime()) ? `once ${when.at}` : `once ${d.toLocaleString()}`;
  }
  if (when.kind === 'every') return `every ${when.every}`;
  return when.tz ? `cron ${when.expr} (${when.tz})` : `cron ${when.expr}`;
}

function formatNext(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const EVERY_OPTIONS = ['15m', '1h', '6h', '1d'] as const;

const FALLBACK_DEFAULTS: ThreadDefaults = {
  agent: 'claude',
  model: null,
  effort: 'high',
  fast: false,
  autonomy: 'full',
};

interface FormState {
  name: string;
  prompt: string;
  kind: CadenceKind;
  atLocal: string;
  every: string;
  cron: string;
  tz: string;
  threadId: string;
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  planMode: boolean;
  autonomy: Autonomy;
  attachments: ThreadAttachment[];
  enabled: boolean;
}

function composerFrom(
  defaults: ThreadDefaults,
  row?: ScheduledTask,
): Pick<
  FormState,
  'agent' | 'model' | 'effort' | 'fast' | 'planMode' | 'autonomy' | 'attachments'
> {
  const agent = row?.agent ?? defaults.agent;
  return {
    agent: (ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(agent)
      ? agent
      : 'claude',
    model: row ? row.model : defaults.model,
    effort: row?.effort ?? defaults.effort,
    fast: row?.fast ?? defaults.fast,
    planMode: row?.planMode ?? false,
    autonomy: row?.autonomy ?? defaults.autonomy,
    attachments: row?.attachments ?? [],
  };
}

function emptyForm(defaults: ThreadDefaults = FALLBACK_DEFAULTS): FormState {
  return {
    name: '',
    prompt: '',
    kind: 'every',
    atLocal: defaultOnceLocal(),
    every: '1h',
    cron: '0 9 * * *',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    threadId: '',
    enabled: true,
    ...composerFrom(defaults),
  };
}

function formFromTask(row: ScheduledTask, defaults: ThreadDefaults): FormState {
  return {
    name: row.name,
    prompt: row.prompt,
    kind: row.when.kind,
    atLocal: row.when.kind === 'once' ? toDatetimeLocal(row.when.at) : defaultOnceLocal(),
    every: row.when.kind === 'every' ? row.when.every : '1h',
    cron: row.when.kind === 'cron' ? row.when.expr : '0 9 * * *',
    tz:
      row.when.kind === 'cron' && row.when.tz
        ? row.when.tz
        : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    threadId: row.threadId ?? '',
    enabled: row.enabled,
    ...composerFrom(defaults, row),
  };
}

function linkRepoPath(thread: Thread | undefined): string | undefined {
  const path = thread?.repoPath?.trim();
  if (!path || path === GLOBAL_WORKSPACE_ID || path === '/' || path === '.') return undefined;
  return path;
}

function whenFromForm(form: FormState): ScheduleWhen {
  if (form.kind === 'once') {
    const at = new Date(form.atLocal);
    if (Number.isNaN(at.getTime())) throw new Error('Pick a valid date and time');
    return { kind: 'once', at: at.toISOString() };
  }
  if (form.kind === 'every') return { kind: 'every', every: form.every };
  return { kind: 'cron', expr: form.cron.trim(), tz: form.tz.trim() || undefined };
}

export function SchedulesSettings() {
  const [rows, setRows] = useState<ScheduledTask[]>([]);
  const [targetThreads, setTargetThreads] = useState<Thread[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<ThreadDefaults>(FALLBACK_DEFAULTS);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [skills, setSkills] = useState<AutocompleteSkill[]>([]);
  const [cursor, setCursor] = useState(0);
  const [acIndex, setAcIndex] = useState(0);
  const [acSuppressed, setAcSuppressed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef('');
  promptRef.current = form.prompt;
  const dictation = useSpeechDictation({
    getValue: () => promptRef.current,
    setValue: (next) => {
      promptRef.current = next;
      setForm((f) => ({ ...f, prompt: next }));
      setCursor(next.length);
    },
    resetKey: editingId ?? 'new',
    disabled: busy || !showForm,
  });

  const reload = useCallback(async () => {
    const [schedules, threads] = await Promise.all([
      window.sideboard.listSchedules(),
      window.sideboard.getThreads(false),
    ]);
    setRows(schedules);
    setTargetThreads(
      threads
        .filter((t) => t.status !== 'archived')
        .sort((a, b) => {
          const ao = a.sourceType === 'orchestration' ? 0 : 1;
          const bo = b.sourceType === 'orchestration' ? 0 : 1;
          if (ao !== bo) return ao - bo;
          return threadDisplayLabel(a).localeCompare(threadDisplayLabel(b));
        }),
    );
  }, []);

  useEffect(() => {
    void loadOrchestratorDefaults().then(setDefaults).catch(() => undefined);
  }, []);

  useEffect(() => {
    void reload().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    const off = window.sideboard.onSchedulesChanged(() => {
      void reload();
    });
    return off;
  }, [reload]);

  const threadLabel = useMemo(() => {
    const map = new Map(targetThreads.map((t) => [t.id, threadDisplayLabel(t)]));
    return (id: string | null) => {
      if (!id) return 'New orchestration agent';
      return map.get(id) ?? `${id.slice(0, 8)}…`;
    };
  }, [targetThreads]);

  async function openCreate() {
    const next = await loadOrchestratorDefaults().catch(() => defaults);
    setDefaults(next);
    setEditingId(null);
    setForm(emptyForm(next));
    setCursor(0);
    setAcSuppressed(false);
    setShowForm(true);
    setError(null);
  }

  async function openEdit(row: ScheduledTask) {
    const next = await loadOrchestratorDefaults().catch(() => defaults);
    setDefaults(next);
    setEditingId(row.id);
    setForm(formFromTask(row, next));
    setCursor(row.prompt.length);
    setAcSuppressed(false);
    setShowForm(true);
    setError(null);
  }

  async function save() {
    const dictated = dictation.listening ? await dictation.stop() : undefined;
    const prompt = (dictated ?? form.prompt).trim();
    if (!prompt) {
      setError('Prompt is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const when = whenFromForm(form);
      const payload: Omit<CreateScheduledTaskInput, 'createdBy'> = {
        name: form.name.trim() || undefined,
        prompt,
        when,
        threadId: form.threadId || null,
        agent: form.agent,
        model: form.model,
        effort: form.effort,
        fast: form.fast,
        planMode: form.planMode,
        autonomy: form.autonomy,
        attachments: form.attachments,
        enabled: form.enabled,
      };
      if (editingId) {
        await window.sideboard.updateSchedule(editingId, payload);
      } else {
        await window.sideboard.createSchedule(payload);
      }
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string) {
    setBusy(true);
    setError(null);
    try {
      const row = await window.sideboard.runSchedule(id);
      if (row.lastError) setError(row.lastError);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(row: ScheduledTask) {
    setBusy(true);
    setError(null);
    try {
      await window.sideboard.updateSchedule(row.id, { enabled: !row.enabled });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await window.sideboard.deleteSchedule(id);
      if (editingId === id) setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const freshChat = showForm && !form.threadId;
  const targetThread = targetThreads.find((t) => t.id === form.threadId);
  const repoPath = linkRepoPath(targetThread);
  const composerOptions: ComposerDraftOptions = {
    agent: form.agent,
    model: form.model,
    effort: form.effort,
    fast: form.fast,
    planMode: form.planMode,
    autonomy: form.autonomy,
  };
  const acQuery = useMemo(
    () => (showForm ? getAutocompleteQuery(form.prompt, cursor) : null),
    [showForm, form.prompt, cursor],
  );
  const acItems: AutocompleteItem[] = useMemo(
    () =>
      autocompleteItemsFromQuery(acQuery, {
        suppressed: acSuppressed,
        skills,
        filePaths,
      }),
    [acQuery, acSuppressed, skills, filePaths],
  );

  useEffect(() => {
    setAcIndex(0);
    setAcSuppressed(false);
  }, [acQuery?.kind, acQuery?.query]);

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    void window.sideboard
      .listSkillsForRepo(repoPath ?? '')
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showForm, repoPath]);

  useEffect(() => {
    if (!showForm || !form.threadId) {
      setFilePaths([]);
      return;
    }
    let cancelled = false;
    void window.sideboard
      .listFiles(form.threadId)
      .then((list) => {
        if (!cancelled) setFilePaths(list);
      })
      .catch(() => {
        if (!cancelled) setFilePaths([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showForm, form.threadId]);

  function patchOptions(patch: Partial<ComposerDraftOptions>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function pickAutocomplete(item: AutocompleteItem) {
    if (!acQuery) return;
    const next = applyAutocomplete(form.prompt, acQuery.start, acQuery.end, item.insert);
    setForm((f) => ({ ...f, prompt: next.value }));
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function stageDroppedSnapshot(snap: ReturnType<typeof snapshotComposerDrop>) {
    if (busy) return;
    const dragged = snap.sideboard;
    if (dragged?.paths.length && dragged.threadId) {
      const files = await Promise.all(
        dragged.paths.map((path) => worktreePathToFile(dragged.threadId!, path)),
      );
      await attachDroppedFiles(files);
      return;
    }
    await attachDroppedFiles(snap.files);
  }

  async function attachDroppedFiles(files: File[]) {
    if (busy || files.length === 0) return;
    const buffers = await buffersFromFiles(files, { includePathed: true });
    const staged =
      buffers.length > 0
        ? await window.sideboard.attachmentsFromBuffers(buffers)
        : await window.sideboard.attachmentsFromPaths(absolutePathsFromFiles(files));
    if (staged.length) {
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...staged] }));
    }
  }

  return (
    <>
    <div className="settings-body">
      <p className="settings-lead">
        Jobs that send a prompt to a chat (Global orchestration or a worktree),
        or start a new Global chat. Sideboard must be running. Creating or
        enabling a future job turns on{' '}
        <strong>Settings → Advanced → Caffeinate while automations are enabled</strong>{' '}
        so the Mac can stay awake until due. A sleeping Mac skips until wake.
      </p>
      {error && <div className="settings-error" style={{ margin: '0 0 12px' }}>{error}</div>}

      <div className="settings-section settings-section-card">
        <div className="automations-toolbar">
          <button type="button" className="primary" disabled={busy} onClick={() => void openCreate()}>
            New
          </button>
        </div>
        <div className="settings-history-list" role="list">
          {rows.length === 0 ? (
            <div className="settings-empty">No automations yet.</div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="settings-history-row" role="listitem">
                <button
                  type="button"
                  className="settings-history-open"
                  onClick={() => void openEdit(row)}
                  title="Edit automation"
                >
                  <span className="settings-history-title">
                    {row.enabled ? row.name : `${row.name} (off)`}
                  </span>
                  <span className="settings-history-meta">
                    {formatWhen(row.when)} · {threadLabel(row.threadId)} · next{' '}
                    {formatNext(row.nextRunAt)}
                    {row.lastError ? ` · ${row.lastError}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="settings-history-restore"
                  disabled={busy}
                  onClick={() => void toggleEnabled(row)}
                >
                  {row.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="settings-history-restore"
                  disabled={busy}
                  onClick={() => void runNow(row.id)}
                >
                  Run now
                </button>
                <button
                  type="button"
                  className="settings-history-restore"
                  disabled={busy}
                  onClick={() => void remove(row.id)}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showForm && (
        <div className="settings-section settings-section-card">
          <div className="settings-section-title">
            {editingId ? 'Edit automation' : 'New automation'}
          </div>
          <label className="settings-field">
            Name
            <input
              className="settings-history-search"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Optional — defaults to the prompt"
            />
          </label>
          <div className="settings-field">
            Prompt
            <div
              className={`composer-box automations-composer${dragOver ? ' drag-over' : ''}`}
              onDragEnter={(e) => {
                if (!preventComposerFileDrag(e)) return;
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setDragOver(false);
              }}
              onDragOver={(e) => {
                if (!canAcceptComposerFileDrop(e.dataTransfer)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setDragOver(true);
              }}
              onDrop={(e) => {
                if (!preventComposerFileDrag(e)) return;
                setDragOver(false);
                const snap = snapshotComposerDrop(e.dataTransfer);
                void stageDroppedSnapshot(snap).catch((err) => {
                  setError(err instanceof Error ? err.message : String(err));
                });
              }}
            >
              <ComposerAttachmentChips
                attachments={form.attachments}
                onRemove={(id) =>
                  setForm((f) => ({
                    ...f,
                    attachments: f.attachments.filter((a) => a.id !== id),
                  }))
                }
              />
              <div className="composer-input-row">
                {acItems.length > 0 && (
                  <ComposerAutocomplete
                    items={acItems}
                    activeIndex={Math.min(acIndex, acItems.length - 1)}
                    onHover={setAcIndex}
                    onPick={pickAutocomplete}
                  />
                )}
                <textarea
                  ref={textareaRef}
                  value={form.prompt}
                  rows={4}
                  disabled={busy}
                  placeholder={
                    form.threadId
                      ? 'What the agent should do when this fires. @ files, / for skills'
                      : 'What the agent should do when this fires. Type / for skills'
                  }
                  onChange={(e) => {
                    setForm((f) => ({ ...f, prompt: e.target.value }));
                    setCursor(e.target.selectionStart);
                  }}
                  onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
                  onClick={(e) => setCursor(e.currentTarget.selectionStart)}
                  onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
                  onPaste={(e) => {
                    if (busy) return;
                    const pasted = e.clipboardData?.files;
                    if (pasted && pasted.length > 0) {
                      e.preventDefault();
                      void attachDroppedFiles(Array.from(pasted)).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                      });
                      return;
                    }
                    void attachmentsFromLargePaste(e, form.attachments)
                      .then((files) => {
                        if (files?.length) {
                          setForm((f) => ({
                            ...f,
                            attachments: [...f.attachments, ...files],
                          }));
                        }
                      })
                      .catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                      });
                  }}
                  onKeyDown={(e) => {
                    if (busy) return;
                    if (
                      consumeAutocompleteKeyDown(e, {
                        items: acItems,
                        activeIndex: acIndex,
                        onIndex: setAcIndex,
                        onPick: pickAutocomplete,
                        onSuppress: () => setAcSuppressed(true),
                      })
                    ) {
                      e.stopPropagation();
                    }
                  }}
                />
              </div>
              {form.planMode && (
                <div className="composer-plan-banner">
                  Plan mode stays on until you turn it off (no file edits).
                </div>
              )}
              <ComposerOptionsToolbar
                options={composerOptions}
                attachments={form.attachments}
                onPatchOptions={patchOptions}
                onAttachmentsChange={(attachments) =>
                  setForm((f) => ({ ...f, attachments }))
                }
                repoPath={repoPath}
                menuPlacement="auto"
                allowedAgents={ORCHESTRATOR_AGENT_KINDS}
                bindShortcuts
                rightSlot={
                  <DictationMicButton
                    listening={dictation.listening}
                    supported={dictation.supported}
                    error={dictation.error}
                    disabled={busy}
                    onStart={dictation.start}
                    onStop={() => {
                      void dictation.stop();
                    }}
                  />
                }
              />
            </div>
            <p className="settings-hint">
              Files, issues, workspaces, and the agent settings on this prompt
              are sent with every run.
            </p>
          </div>
          <label className="settings-field">
            Cadence
            <select
              className="settings-select"
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({ ...f, kind: e.target.value as CadenceKind }))
              }
            >
              <option value="once">Once at a datetime</option>
              <option value="every">Every interval</option>
              <option value="cron">Cron</option>
            </select>
          </label>
          {form.kind === 'once' && (
            <label className="settings-field">
              When
              <input
                className="settings-history-search"
                type="datetime-local"
                value={form.atLocal}
                onChange={(e) => setForm((f) => ({ ...f, atLocal: e.target.value }))}
              />
            </label>
          )}
          {form.kind === 'every' && (
            <label className="settings-field">
              Interval
              <select
                className="settings-select"
                value={form.every}
                onChange={(e) => setForm((f) => ({ ...f, every: e.target.value }))}
              >
                {EVERY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.kind === 'cron' && (
            <>
              <label className="settings-field">
                Cron (5-field)
                <input
                  className="settings-history-search"
                  value={form.cron}
                  onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
                  placeholder="0 9 * * *"
                  spellCheck={false}
                />
              </label>
              <label className="settings-field">
                Timezone
                <input
                  className="settings-history-search"
                  value={form.tz}
                  onChange={(e) => setForm((f) => ({ ...f, tz: e.target.value }))}
                  placeholder="America/Los_Angeles"
                  spellCheck={false}
                />
              </label>
            </>
          )}
          <label className="settings-field">
            Target
            <select
              className="settings-select"
              value={form.threadId}
              onChange={(e) => setForm((f) => ({ ...f, threadId: e.target.value }))}
            >
              <option value="">New orchestration agent each run</option>
              {targetThreads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.sourceType === 'orchestration'
                    ? `${threadDisplayLabel(t)} (orchestration)`
                    : threadDisplayLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          {freshChat && (
            <p className="settings-hint">
              {form.kind === 'once'
                ? 'A one-shot with no target chat opens a new Global orchestration agent and archives it when that run finishes. History keeps that run.'
                : 'Recurring jobs with no target chat open a new Global orchestration agent each run and archive it when that run finishes. History keeps the latest run for this automation.'}
            </p>
          )}
          <div className="settings-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              {editingId ? 'Save' : 'Create'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (dictation.listening) void dictation.stop();
                setShowForm(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
    <DictationPermissionDialog error={dictation.error} onDismiss={dictation.clearError} />
    </>
  );
}
