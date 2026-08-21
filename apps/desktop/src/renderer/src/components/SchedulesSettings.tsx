import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentKind,
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduleWhen,
  Thread,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { threadDisplayLabel } from '@sideboard/worktree-labels';

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

interface FormState {
  name: string;
  prompt: string;
  kind: CadenceKind;
  atLocal: string;
  every: string;
  cron: string;
  tz: string;
  threadId: string;
  agent: AgentKind | '';
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    prompt: '',
    kind: 'every',
    atLocal: defaultOnceLocal(),
    every: '1h',
    cron: '0 9 * * *',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    threadId: '',
    agent: '',
    enabled: true,
  };
}

function formFromTask(row: ScheduledTask): FormState {
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
    agent: row.agent ?? '',
    enabled: row.enabled,
  };
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
  const [orchThreads, setOrchThreads] = useState<Thread[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const reload = useCallback(async () => {
    const [schedules, threads] = await Promise.all([
      window.sideboard.listSchedules(),
      window.sideboard.getThreads(false),
    ]);
    setRows(schedules);
    setOrchThreads(
      threads.filter(
        (t) => t.sourceType === 'orchestration' && t.status !== 'archived',
      ),
    );
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
    const map = new Map(orchThreads.map((t) => [t.id, threadDisplayLabel(t)]));
    return (id: string | null) => {
      if (!id) return 'New orchestration chat';
      return map.get(id) ?? `${id.slice(0, 8)}…`;
    };
  }, [orchThreads]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setError(null);
  }

  function openEdit(row: ScheduledTask) {
    setEditingId(row.id);
    setForm(formFromTask(row));
    setShowForm(true);
    setError(null);
  }

  async function save() {
    const prompt = form.prompt.trim();
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
        agent: form.agent || null,
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

  const recurringNewChat =
    showForm && form.kind !== 'once' && !form.threadId;

  return (
    <div className="settings-body">
      <p className="settings-lead">
        Jobs that send a prompt to an orchestration chat, or start a new Global
        chat. Sideboard must be running. A sleeping Mac skips until wake — turn
        on <strong>Settings → Advanced → Caffeinate while schedules are enabled</strong>{' '}
        (or <code>set_caffeinate</code> from a chat) for overnight runs.
      </p>
      {error && <div className="settings-error" style={{ margin: '0 0 12px' }}>{error}</div>}

      <div className="settings-section settings-section-card">
        <div className="settings-toggle-row">
          <div className="settings-section-title">Schedules</div>
          <button type="button" className="primary" disabled={busy} onClick={openCreate}>
            New
          </button>
        </div>
        <div className="settings-history-list" role="list">
          {rows.length === 0 ? (
            <div className="settings-empty">No schedules yet.</div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="settings-history-row" role="listitem">
                <button
                  type="button"
                  className="settings-history-open"
                  onClick={() => openEdit(row)}
                  title="Edit schedule"
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
            {editingId ? 'Edit schedule' : 'New schedule'}
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
          <label className="settings-field">
            Prompt
            <textarea
              className="settings-history-search"
              rows={4}
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="What the orchestration agent should do"
            />
          </label>
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
              <option value="">New orchestration chat each run</option>
              {orchThreads.map((t) => (
                <option key={t.id} value={t.id}>
                  {threadDisplayLabel(t)}
                </option>
              ))}
            </select>
          </label>
          {!form.threadId && (
            <label className="settings-field">
              Agent for new chats
              <select
                className="settings-select"
                value={form.agent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, agent: e.target.value as AgentKind | '' }))
                }
              >
                <option value="">Account default</option>
                {ORCHESTRATOR_AGENT_KINDS.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          {recurringNewChat && (
            <p className="settings-hint">
              Recurring jobs with no target chat open a new Global orchestration
              chat each run.
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
  );
}
