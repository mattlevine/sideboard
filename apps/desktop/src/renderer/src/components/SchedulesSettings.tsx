import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduledTask, ScheduleWhen, Thread } from '@sideboard-ai/core';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import { AutomationEditor } from './AutomationEditor';
import { emptyForm, formFromTask, whenFromForm, type FormState } from './automation-form';
import { loadOrchestratorDefaults, type ThreadDefaults } from '../lib/thread-defaults';

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

const FALLBACK_DEFAULTS: ThreadDefaults = {
  agent: 'claude',
  model: null,
  effort: 'high',
  fast: false,
  autonomy: 'full',
};

export function SchedulesSettings() {
  const [rows, setRows] = useState<ScheduledTask[]>([]);
  const [targetThreads, setTargetThreads] = useState<Thread[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<ThreadDefaults>(FALLBACK_DEFAULTS);
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
    setShowForm(true);
    setError(null);
  }

  async function openEdit(row: ScheduledTask) {
    const next = await loadOrchestratorDefaults().catch(() => defaults);
    setDefaults(next);
    setEditingId(row.id);
    setForm(formFromTask(row, next));
    setShowForm(true);
    setError(null);
  }

  async function save(prompt: string) {
    setBusy(true);
    setError(null);
    try {
      const name = form.name.trim();
      const payload = {
        ...(name ? { name } : {}),
        prompt,
        when: whenFromForm(form),
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
      if (editingId) await window.sideboard.updateSchedule(editingId, payload);
      else await window.sideboard.createSchedule(payload);
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

  return (
    <div className="settings-body">
      <p className="settings-lead">
        Jobs that send a prompt to a chat (Global orchestration or a worktree), or start a new
        Global chat. Sideboard must be running. Creating or enabling a future job turns on{' '}
        <strong>Settings → Advanced → Caffeinate while automations are enabled</strong> so the Mac
        can stay awake until due. A sleeping Mac skips until wake.
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
                    {formatWhen(row.when)} · {threadLabel(row.threadId)} · next {formatNext(row.nextRunAt)}
                    {row.lastError ? ` · ${row.lastError}` : ''}
                  </span>
                </button>
                <button type="button" className="settings-history-restore" disabled={busy} onClick={() => void toggleEnabled(row)}>
                  {row.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="settings-history-restore" disabled={busy} onClick={() => void runNow(row.id)}>
                  Run now
                </button>
                <button type="button" className="settings-history-restore" disabled={busy} onClick={() => void remove(row.id)}>
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      {showForm && (
        <AutomationEditor
          form={form}
          setForm={setForm}
          busy={busy}
          editingId={editingId}
          threads={targetThreads}
          onSave={save}
          onCancel={() => {
            setShowForm(false);
            setError(null);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}
