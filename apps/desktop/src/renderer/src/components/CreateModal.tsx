import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentStatus,
  ThreadAttachment,
  Workspace,
} from '@sideboard-ai/core';
import {
  ComposerAttachmentChips,
  ComposerOptionsToolbar,
  type ComposerDraftOptions,
} from './ComposerOptionsToolbar';
import {
  CreateFromPicker,
  type CreateFromSelection,
} from './CreateFromPicker';
import { CreateProcessingOverlay } from './CreateProcessingOverlay';
import { FloatingMenu } from './FloatingMenu';

type Mode = 'create' | 'orchestration';

interface Props {
  /** Preselected workspace path (from per-repo +). */
  initialRepoPath?: string | null;
  /** Workspaces already known from the board (threads / app state). */
  knownWorkspaces?: Workspace[];
  initialMode?: 'quick' | 'orchestration';
  onClose: () => void;
  onCreated: (threadId: string, opts?: { stayOpen?: boolean }) => void;
  /** Called after a workspace is added so the sidebar can refresh. */
  onWorkspacesChanged?: () => void;
  /** Open Settings → Account (e.g. Linear setup). */
  onOpenAccount?: () => void;
}

function dedupeWorkspaces(list: Workspace[]): Workspace[] {
  const byPath = new Map<string, Workspace>();
  for (const w of list) {
    if (w?.path) byPath.set(w.path, w);
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const DEFAULT_OPTIONS: ComposerDraftOptions = {
  agent: 'claude',
  model: null,
  fast: false,
  planMode: false,
  autonomy: 'default',
};

const AVATAR_COLORS = [
  '#c45c26',
  '#2d6a4f',
  '#1d3557',
  '#6a4c93',
  '#bc4749',
  '#0077b6',
  '#b08968',
  '#3a5a40',
];

function repoAvatarStyle(name: string): { background: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

function selectionLabel(sel: CreateFromSelection | null): string {
  if (!sel) return 'Create from…';
  if (sel.kind === 'pr') return `PR #${sel.ref}${sel.title ? ` — ${sel.title}` : ''}`;
  if (sel.kind === 'ticket') return `${sel.ref}${sel.title ? ` — ${sel.title}` : ''}`;
  if (sel.ref === 'default') return 'default branch';
  return sel.ref;
}

export function CreateModal({
  initialRepoPath = null,
  knownWorkspaces = [],
  initialMode = 'quick',
  onClose,
  onCreated,
  onWorkspacesChanged,
  onOpenAccount,
}: Props) {
  const [mode, setMode] = useState<Mode>(
    initialMode === 'orchestration' ? 'orchestration' : 'create',
  );
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() =>
    dedupeWorkspaces(knownWorkspaces),
  );
  const [repoPath, setRepoPath] = useState(
    initialRepoPath ?? knownWorkspaces[0]?.path ?? '',
  );
  const [options, setOptions] = useState<ComposerDraftOptions>(DEFAULT_OPTIONS);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selection, setSelection] = useState<CreateFromSelection | null>(null);
  const [linearConnected, setLinearConnected] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [goal, setGoal] = useState('');
  const [createMore, setCreateMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.path === repoPath) ?? null,
    [workspaces, repoPath],
  );
  const repoName =
    mode === 'orchestration'
      ? 'Orchestration'
      : selectedWorkspace?.name ||
        (repoPath ? repoPath.split('/').filter(Boolean).pop() : '') ||
        'Select project';

  async function refreshWorkspaces(preferred?: string | null) {
    const collected: Workspace[] = [...knownWorkspaces];

    try {
      const listed = await window.sideboard.listWorkspaces();
      if (Array.isArray(listed)) collected.push(...listed);
    } catch (err) {
      console.error('listWorkspaces failed', err);
    }

    try {
      const threads = await window.sideboard.getThreads(true);
      for (const t of threads) {
        if (!t.repoPath) continue;
        let root = t.repoPath;
        try {
          root = await window.sideboard.resolveRepoRoot(t.repoPath);
        } catch {
          // keep t.repoPath
        }
        const name = root.split('/').filter(Boolean).pop() || root;
        collected.push({
          path: root,
          name,
          addedAt: t.createdAt,
        });
        try {
          await window.sideboard.addWorkspace(root);
        } catch {
          // ignore per-thread add failures
        }
      }
    } catch {
      // ignore
    }

    try {
      const current = await window.sideboard.getRepoPath();
      if (current) {
        let root = current;
        try {
          root = await window.sideboard.resolveRepoRoot(current);
        } catch {
          // keep current
        }
        const name = root.split('/').filter(Boolean).pop() || root;
        collected.push({ path: root, name, addedAt: new Date().toISOString() });
        try {
          await window.sideboard.addWorkspace(root);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    const list = dedupeWorkspaces(collected);
    setWorkspaces(list);
    setRepoPath((current) => {
      if (preferred && list.some((w) => w.path === preferred)) return preferred;
      if (current && list.some((w) => w.path === current)) return current;
      return list[0]?.path ?? '';
    });
    return list;
  }

  useEffect(() => {
    setAgentsLoaded(false);
    void window.sideboard
      .detectAgents()
      .then(setStatuses)
      .catch(() => setStatuses([]))
      .finally(() => setAgentsLoaded(true));
    void refreshWorkspaces(initialRepoPath);
    void window.sideboard
      .getAppSettings()
      .then((s) => setLinearConnected(Boolean(s.integrations?.linearApiKey)))
      .catch(() => setLinearConnected(false));
  }, [initialRepoPath]);

  useEffect(() => {
    setSelection(null);
    setPickerOpen(false);
  }, [repoPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        void window.sideboard.pickFiles().then((files) => {
          if (files.length) setAttachments((prev) => [...prev, ...files]);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const agentStatus = statuses.find((s) => s.agent === options.agent);
  const agentOk = Boolean(agentStatus?.installed && agentStatus.authenticated);

  async function addWorkspace() {
    setError(null);
    setRepoMenuOpen(false);
    setMoreMenuOpen(false);
    const picked = await window.sideboard.pickRepoPath();
    if (!picked) return;
    try {
      await window.sideboard.addWorkspace(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refreshWorkspaces(picked);
    onWorkspacesChanged?.();
  }

  function patchOptions(patch: Partial<ComposerDraftOptions>) {
    setOptions((prev) => ({ ...prev, ...patch }));
  }

  function resetDraft() {
    setPrompt('');
    setGoal('');
    setSelection(null);
    setAttachments([]);
    setError(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function submit() {
    if (mode !== 'orchestration' && !repoPath) {
      setError('Add a project first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = {
        agent: options.agent,
        autonomy: options.autonomy,
        model: options.model,
        fast: options.fast,
        planMode: options.planMode,
        attachments,
      };

      if (mode === 'orchestration') {
        if (!goal.trim()) throw new Error('Describe the orchestration goal');
        const t = await window.sideboard.startOrchestration({
          goal: goal.trim(),
          ...draft,
        });
        if (createMore) {
          onCreated(t.id, { stayOpen: true });
          resetDraft();
        } else {
          onCreated(t.id);
          onClose();
        }
        return;
      }

      let sourceType: 'branch' | 'pr' | 'ticket' = 'branch';
      let sourceRef = 'default';
      let title: string | undefined;
      let createAttachments = [...attachments];

      if (selection) {
        if (selection.kind === 'pr') {
          sourceType = 'pr';
          sourceRef = selection.ref;
          title = selection.title;
        } else if (selection.kind === 'ticket') {
          sourceType = 'ticket';
          sourceRef = selection.ref;
          title = selection.title;
          createAttachments = [
            ...createAttachments,
            {
              id: crypto.randomUUID(),
              name: selection.ref,
              kind: 'issue',
              content: [
                `Linked issue: ${selection.ref} — ${selection.title}`,
                selection.url ? `URL: ${selection.url}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ];
        } else {
          sourceType = 'branch';
          sourceRef = selection.ref;
        }
      }

      const t = await window.sideboard.createThread({
        sourceType,
        sourceRef,
        repoPath,
        title,
        prompt: prompt.trim() || undefined,
        ...draft,
        attachments: createAttachments,
      });
      if (createMore) {
        onCreated(t.id, { stayOpen: true });
        resetDraft();
      } else {
        onCreated(t.id);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const promptValue = mode === 'orchestration' ? goal : prompt;
  const setPromptValue = mode === 'orchestration' ? setGoal : setPrompt;
  const canSubmit =
    !busy &&
    agentsLoaded &&
    agentOk &&
    (mode === 'orchestration'
      ? Boolean(goal.trim())
      : Boolean(repoPath));

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={`modal create-modal${busy ? ' is-creating' : ''}`}
        role="dialog"
        aria-label="New thread"
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
      >
        {busy ? (
          <CreateProcessingOverlay
            mode={mode}
            repoName={repoName}
            selectionHint={
              selection
                ? selection.kind === 'pr'
                  ? `PR #${selection.ref}`
                  : selection.kind === 'ticket'
                    ? selection.ref
                    : selection.ref === 'default'
                      ? 'default branch'
                      : selection.ref
                : null
            }
          />
        ) : null}

        <div className={`create-modal-content${busy ? ' veiled' : ''}`}>
        <div className="create-header">
          <div className="create-header-left">
            <button
              ref={repoBtnRef}
              type="button"
              className="create-repo-trigger"
              disabled={busy}
              onClick={() => {
                setMoreMenuOpen(false);
                setRepoMenuOpen((v) => !v);
              }}
            >
              <span
                className="create-repo-avatar"
                style={repoAvatarStyle(repoName)}
                aria-hidden
              >
                {(repoName[0] || '?').toUpperCase()}
              </span>
              <span className="create-repo-name">{repoName}</span>
              <span className="create-from-chevron">▾</span>
            </button>
            <button
              ref={moreBtnRef}
              type="button"
              className="create-icon-btn"
              title="More"
              aria-label="More options"
              onClick={() => {
                setRepoMenuOpen(false);
                setMoreMenuOpen((v) => !v);
              }}
            >
              ···
            </button>
            <FloatingMenu
              open={repoMenuOpen}
              onClose={() => setRepoMenuOpen(false)}
              anchorRef={repoBtnRef}
              align="left"
              placement="down"
              minWidth={240}
            >
              {workspaces.length === 0 ? (
                <div className="menu-section">No projects yet</div>
              ) : (
                workspaces.map((w) => (
                  <button
                    key={w.path}
                    type="button"
                    className={w.path === repoPath ? 'selected' : ''}
                    onClick={() => {
                      setRepoPath(w.path);
                      setPickerOpen(false);
                      setRepoMenuOpen(false);
                    }}
                  >
                    <span>
                      {w.path === repoPath ? '✓ ' : ''}
                      {w.name}
                    </span>
                  </button>
                ))
              )}
              <div className="menu-section">Projects</div>
              <button type="button" onClick={() => void addWorkspace()}>
                <span>Add project…</span>
              </button>
            </FloatingMenu>
            <FloatingMenu
              open={moreMenuOpen}
              onClose={() => setMoreMenuOpen(false)}
              anchorRef={moreBtnRef}
              align="left"
              placement="down"
              minWidth={220}
            >
              <button
                type="button"
                className={mode === 'create' ? 'selected' : ''}
                onClick={() => {
                  setMode('create');
                  setMoreMenuOpen(false);
                }}
              >
                <span>{mode === 'create' ? '✓ ' : ''}New thread</span>
              </button>
              <button
                type="button"
                className={mode === 'orchestration' ? 'selected' : ''}
                onClick={() => {
                  setMode('orchestration');
                  setMoreMenuOpen(false);
                }}
              >
                <span>{mode === 'orchestration' ? '✓ ' : ''}Orchestration</span>
              </button>
              <div className="menu-section">Projects</div>
              <button type="button" onClick={() => void addWorkspace()}>
                <span>Add project…</span>
              </button>
            </FloatingMenu>
          </div>

          <div className="create-header-right">
            <button
              type="button"
              className="create-from-trigger"
              disabled={!repoPath || mode === 'orchestration' || busy}
              onClick={() => setPickerOpen(true)}
            >
              <span className="composer-picker-icons" aria-hidden>
                <span className="picker-logo github tiny" />
                {linearConnected ? <span className="picker-logo linear tiny" /> : null}
              </span>
              <span className="create-from-label">{selectionLabel(selection)}</span>
              <span className="create-from-chevron">▾</span>
            </button>
          </div>
        </div>

        <div className="create-body">
          {options.planMode && (
            <div className="composer-plan-banner">
              Plan mode stays on until you turn it off (no file edits).
            </div>
          )}
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={(id) =>
              setAttachments((prev) => prev.filter((a) => a.id !== id))
            }
          />
          <textarea
            ref={textareaRef}
            className="create-composer-input"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            rows={5}
            autoFocus
            disabled={busy}
            readOnly={busy}
            placeholder={
              mode === 'orchestration'
                ? 'Coordination goal across threads…'
                : 'What do you want to work on?'
            }
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) void submit();
              }
            }}
          />
        </div>

        {(agentsLoaded && !agentOk) || error ? (
          <div className="create-errors">
            {agentsLoaded && !agentOk && (
              <p>{agentStatus?.reason ?? 'Agent unavailable'}</p>
            )}
            {error && <p>{error}</p>}
          </div>
        ) : null}

        <div className="create-footer">
          <ComposerOptionsToolbar
            options={options}
            attachments={attachments}
            onPatchOptions={patchOptions}
            onAttachmentsChange={setAttachments}
            repoPath={repoPath || undefined}
            menuPlacement="auto"
            variant="create"
            rightSlot={
              <>
                <label className="create-more-toggle" title="Keep dialog open after create">
                  <button
                    type="button"
                    className={`settings-switch create-more-switch${createMore ? ' on' : ''}`}
                    role="switch"
                    aria-checked={createMore}
                    disabled={busy}
                    onClick={() => setCreateMore((v) => !v)}
                  >
                    <span className="settings-switch-knob" />
                  </button>
                  <span>Create more</span>
                </label>
                <button
                  type="button"
                  className={`create-submit-btn${busy ? ' is-busy' : ''}`}
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  {busy ? (
                    <>
                      <span className="create-submit-spinner" aria-hidden />
                      Creating
                    </>
                  ) : (
                    <>
                      Create <kbd>↵</kbd>
                    </>
                  )}
                </button>
              </>
            }
          />
        </div>
        </div>
      </div>

      <CreateFromPicker
        open={pickerOpen && !busy}
        repoPath={repoPath}
        linearConnected={linearConnected}
        hasSelection={Boolean(selection)}
        onClose={() => setPickerOpen(false)}
        onSelect={setSelection}
        onClear={() => setSelection(null)}
        onOpenAccount={onOpenAccount}
      />
    </div>
  );
}
