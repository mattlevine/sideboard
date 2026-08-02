import { useEffect, useState } from 'react';
import type {
  AgentStatus,
  BranchInfo,
  ThreadAttachment,
  Workspace,
} from '@sideboard/core';
import {
  ComposerAttachmentChips,
  ComposerOptionsToolbar,
  type ComposerDraftOptions,
} from './ComposerOptionsToolbar';

type Mode = 'quick' | 'advanced';
type AdvancedTab = 'branch' | 'pr' | 'ticket' | 'orchestration';

interface Props {
  /** Preselected workspace path (from per-repo +). */
  initialRepoPath?: string | null;
  /** Workspaces already known from the board (threads / app state). */
  knownWorkspaces?: Workspace[];
  initialMode?: 'quick' | 'orchestration';
  onClose: () => void;
  onCreated: (threadId: string) => void;
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

export function CreateModal({
  initialRepoPath = null,
  knownWorkspaces = [],
  initialMode = 'quick',
  onClose,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode === 'orchestration' ? 'advanced' : 'quick');
  const [tab, setTab] = useState<AdvancedTab>(
    initialMode === 'orchestration' ? 'orchestration' : 'branch',
  );
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => dedupeWorkspaces(knownWorkspaces));
  const [repoPath, setRepoPath] = useState(
    initialRepoPath ?? knownWorkspaces[0]?.path ?? '',
  );
  const [options, setOptions] = useState<ComposerDraftOptions>(DEFAULT_OPTIONS);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branch, setBranch] = useState('default');
  const [pr, setPr] = useState('');
  const [ticket, setTicket] = useState('');
  const [prompt, setPrompt] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const name = t.repoPath.split('/').filter(Boolean).pop() || t.repoPath;
        collected.push({
          path: t.repoPath,
          name,
          addedAt: t.createdAt,
        });
        try {
          await window.sideboard.addWorkspace(t.repoPath);
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
        const name = current.split('/').filter(Boolean).pop() || current;
        collected.push({ path: current, name, addedAt: new Date().toISOString() });
        try {
          await window.sideboard.addWorkspace(current);
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
  }, [initialRepoPath]);

  useEffect(() => {
    if (!repoPath) return;
    void window.sideboard
      .listBranches(repoPath)
      .then((b) => {
        const usable = b.filter((x) => !x.name.startsWith('thread/'));
        setBranches(usable);
        // Keep "default branch" selected — new threads fork from up-to-date origin/main.
        setBranch((prev) => (prev === 'default' || !usable.some((x) => x.name === prev) ? 'default' : prev));
      })
      .catch(() => {
        setBranches([]);
        setBranch('default');
      });
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
    const picked = await window.sideboard.pickRepoPath();
    if (!picked) return;
    try {
      await window.sideboard.addWorkspace(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refreshWorkspaces(picked);
  }

  function patchOptions(patch: Partial<ComposerDraftOptions>) {
    setOptions((prev) => ({ ...prev, ...patch }));
  }

  async function submit() {
    if (!repoPath) {
      setError('Add a workspace first (Add…)');
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

      if (mode === 'advanced' && tab === 'orchestration') {
        if (!goal.trim()) throw new Error('Describe the orchestration goal');
        const t = await window.sideboard.startOrchestration({
          goal: goal.trim(),
          repoPath,
          ...draft,
        });
        onCreated(t.id);
        onClose();
        return;
      }

      let sourceType: 'branch' | 'pr' | 'ticket' = 'branch';
      let sourceRef = 'default';

      if (mode === 'advanced') {
        if (tab === 'pr') {
          sourceType = 'pr';
          sourceRef = pr.replace(/^#/, '');
        } else if (tab === 'ticket') {
          sourceType = 'ticket';
          sourceRef = ticket.toUpperCase();
        } else {
          sourceType = 'branch';
          sourceRef = branch === 'default' ? 'default' : branch;
        }
      }

      if (!sourceRef) throw new Error('Pick a source');

      const t = await window.sideboard.createThread({
        sourceType,
        sourceRef,
        repoPath,
        prompt: prompt.trim() || undefined,
        ...draft,
      });
      onCreated(t.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const promptValue = mode === 'advanced' && tab === 'orchestration' ? goal : prompt;
  const setPromptValue =
    mode === 'advanced' && tab === 'orchestration' ? setGoal : setPrompt;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal create-modal" onClick={(e) => e.stopPropagation()}>
        <div className="create-header">
          <div className="row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Workspace</label>
            {workspaces.length > 0 ? (
              <select
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                style={{ flex: 1 }}
              >
                {workspaces.map((w) => (
                  <option key={w.path} value={w.path}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="thread-meta" style={{ flex: 1 }}>
                No workspaces yet — click Add…
              </span>
            )}
            <button type="button" className="primary" onClick={() => void addWorkspace()}>
              Add…
            </button>
          </div>
          <div className="tab-bar" style={{ marginBottom: 0 }}>
            <button
              className={mode === 'quick' ? 'active primary' : ''}
              onClick={() => setMode('quick')}
            >
              Create
            </button>
            <button
              className={mode === 'advanced' ? 'active primary' : ''}
              onClick={() => setMode('advanced')}
            >
              Advanced
            </button>
          </div>
        </div>

        {mode === 'advanced' && (
          <div className="tab-bar">
            {(['branch', 'pr', 'ticket', 'orchestration'] as AdvancedTab[]).map((t) => (
              <button
                key={t}
                className={tab === t ? 'active primary' : ''}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {mode === 'advanced' && tab === 'branch' && (
          <div className="row">
            <label>From</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ flex: 1 }}>
              <option value="default">default branch</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.current ? '* ' : ''}
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'advanced' && tab === 'pr' && (
          <div className="row">
            <label>PR #</label>
            <input
              value={pr}
              onChange={(e) => setPr(e.target.value)}
              placeholder="50"
              style={{ flex: 1 }}
            />
          </div>
        )}

        {mode === 'advanced' && tab === 'ticket' && (
          <div className="row">
            <label>Ticket</label>
            <input
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="ABC-123"
              style={{ flex: 1 }}
            />
          </div>
        )}

        <div className="composer-shell create-composer">
          <div className="composer-box expanded">
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
            <div className="composer-input-row">
              <span className="composer-cube" aria-hidden />
              <textarea
                className="create-composer-input"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                rows={4}
                autoFocus
                placeholder={
                  mode === 'advanced' && tab === 'orchestration'
                    ? 'Coordination goal across threads…'
                    : mode === 'quick'
                      ? 'What do you want to work on?'
                      : 'Optional: first message to the agent…'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            <ComposerOptionsToolbar
              options={options}
              attachments={attachments}
              onPatchOptions={patchOptions}
              onAttachmentsChange={setAttachments}
              repoPath={repoPath || undefined}
              menuPlacement="down"
            />
          </div>
        </div>

        {agentsLoaded && !agentOk && (
          <p style={{ color: 'var(--err)', margin: '8px 0 0' }}>
            {agentStatus?.reason ?? 'Agent unavailable'}
          </p>
        )}
        {error && <p style={{ color: 'var(--err)' }}>{error}</p>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, marginBottom: 0 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy || !agentsLoaded || !agentOk || !repoPath}
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create ↵'}
          </button>
        </div>
      </div>
    </div>
  );
}
