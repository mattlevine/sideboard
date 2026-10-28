import { useRef } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import type { ComposerDraftOptions } from './ComposerOptionsToolbar';
import { AutomationPrompt } from './AutomationPrompt';
import { DictationPermissionDialog } from './DictationPermissionDialog';
import { GLOBAL_WORKSPACE_ID } from '../lib/global-workspace';
import { useSpeechDictation } from '../lib/use-speech-dictation';
import { orchestratorAgent, type FormState } from './automation-form';

const EVERY_OPTIONS = ['15m', '1h', '6h', '1d'] as const;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function linkRepoPath(thread: Thread | undefined): string | undefined {
  const path = thread?.repoPath?.trim();
  if (!path || path === GLOBAL_WORKSPACE_ID || path === '/' || path === '.') return undefined;
  return path;
}

export function AutomationEditor({
  form,
  setForm,
  busy,
  editingId,
  threads,
  onSave,
  onCancel,
  onError,
}: {
  form: FormState;
  setForm: (next: FormState | ((form: FormState) => FormState)) => void;
  busy: boolean;
  editingId: string | null;
  threads: Thread[];
  onSave: (prompt: string) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const promptRef = useRef(form.prompt);
  promptRef.current = form.prompt;
  const dictation = useSpeechDictation({
    getValue: () => promptRef.current,
    setValue: (next) => {
      promptRef.current = next;
      setForm((f) => ({ ...f, prompt: next }));
    },
    resetKey: editingId ?? 'new',
    disabled: busy,
  });
  const targetThread = threads.find((t) => t.id === form.threadId);
  const composerOptions: ComposerDraftOptions = {
    agent: form.agent,
    model: form.model,
    effort: form.effort,
    fast: form.fast,
    planMode: form.planMode,
    autonomy: form.autonomy,
  };

  async function save() {
    const dictated = dictation.listening ? await dictation.stop() : undefined;
    const prompt = (dictated ?? form.prompt).trim();
    if (!prompt) {
      onError('Prompt is required');
      return;
    }
    await onSave(prompt);
  }

  return (
    <div className="automations-editor">
      <h3 id="automation-editor-title">{editingId ? 'Edit automation' : 'New automation'}</h3>
      <label className="settings-field">
        Name
        <input
          className="settings-history-search"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Optional — defaults to the prompt"
        />
      </label>
      <AutomationPrompt
        prompt={form.prompt}
        threadId={form.threadId}
        attachments={form.attachments}
        planMode={form.planMode}
        busy={busy}
        repoPath={linkRepoPath(targetThread)}
        composerOptions={composerOptions}
        dictation={dictation}
        onPrompt={(prompt) => setForm((f) => ({ ...f, prompt }))}
        onAttachments={(attachments) => setForm((f) => ({ ...f, attachments }))}
        onPatchOptions={(patch) =>
          setForm((f) => ({
            ...f,
            ...patch,
            agent: patch.agent ? orchestratorAgent(patch.agent) : f.agent,
          }))
        }
        onError={onError}
      />
      <label className="settings-field">
        Cadence
        <select
          className="settings-select"
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as FormState['kind'] }))}
        >
          <option value="once">Once at a datetime</option>
          <option value="every">Every interval</option>
          <option value="weekly">Days at a time</option>
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
      {form.kind === 'weekly' && (
        <>
          <label className="settings-field">
            Time
            <input
              className="settings-history-search"
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            />
          </label>
          <div className="settings-field">
            Days
            <div className="automation-day-row" role="group" aria-label="Days">
              {WEEKDAY_LABELS.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  className={form.days.includes(day) ? 'is-on' : ''}
                  aria-pressed={form.days.includes(day)}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      days: f.days.includes(day)
                        ? f.days.filter((value) => value !== day)
                        : [...f.days, day],
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="automation-day-presets">
              <button
                type="button"
                className="settings-inline-btn"
                onClick={() => setForm((f) => ({ ...f, days: [0, 1, 2, 3, 4, 5, 6] }))}
              >
                Daily
              </button>
              <button
                type="button"
                className="settings-inline-btn"
                onClick={() => setForm((f) => ({ ...f, days: [1, 2, 3, 4, 5] }))}
              >
                Weekdays
              </button>
              <button
                type="button"
                className="settings-inline-btn"
                onClick={() => setForm((f) => ({ ...f, days: [0, 6] }))}
              >
                Weekends
              </button>
            </div>
          </div>
        </>
      )}
      {form.kind === 'cron' && (
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
      )}
      {(form.kind === 'cron' || form.kind === 'weekly') && (
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
      )}
      <label className="settings-field">
        Target
        <select
          className="settings-select"
          value={form.threadId}
          onChange={(e) => setForm((f) => ({ ...f, threadId: e.target.value }))}
        >
          <option value="">New orchestration agent each run</option>
          {threads.map((t) => (
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
      {!form.threadId && (
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={form.archiveChat}
            onChange={(e) => setForm((f) => ({ ...f, archiveChat: e.target.checked }))}
          />
          Archive the chat when the run finishes
        </label>
      )}
      {!form.threadId && (
        <p className="settings-hint">
          {form.archiveChat
            ? 'History keeps the last 5 runs of this automation. Leave this off when you want the chat to stay in the sidebar, such as a morning start-my-day run you will continue at your desk.'
            : 'The chat stays in the sidebar after the run so you can keep talking. The next run opens a new chat.'}
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
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
      <DictationPermissionDialog error={dictation.error} onDismiss={dictation.clearError} />
    </div>
  );
}
