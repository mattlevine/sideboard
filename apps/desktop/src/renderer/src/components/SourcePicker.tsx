import { useEffect, useState } from 'react';
import type { AgentKind, AgentStatus, BranchInfo, IssueInfo, PrInfo } from '@sideboard/core';

type Tab = 'branch' | 'pr' | 'ticket' | 'orchestration';

interface Props {
  repoPath: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

export function SourcePicker({ repoPath, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<Tab>('branch');
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [prs, setPrs] = useState<PrInfo[]>([]);
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [branch, setBranch] = useState('');
  const [pr, setPr] = useState('');
  const [ticket, setTicket] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.sideboard.detectAgents().then(setStatuses);
    void window.sideboard.listBranches(repoPath).then((b) => {
      setBranches(b);
      const current = b.find((x) => x.current)?.name ?? b[0]?.name ?? '';
      setBranch(current);
    });
    void window.sideboard.listPrs(repoPath).then(setPrs).catch(() => setPrs([]));
  }, [repoPath]);

  useEffect(() => {
    if (tab !== 'ticket') return;
    void window.sideboard
      .listLinearIssues(agent, repoPath)
      .then(setIssues)
      .catch((err: unknown) => {
        setIssues([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, agent, repoPath]);

  const agentStatus = statuses.find((s) => s.agent === agent);
  const agentOk = Boolean(agentStatus?.installed && agentStatus.authenticated);
  const ticketOk = agentOk && Boolean(agentStatus?.linearMcp);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'orchestration') {
        const t = await window.sideboard.startOrchestration({ goal, agent, repoPath });
        onCreated(t.id);
        onClose();
        return;
      }
      const sourceType = tab;
      const sourceRef =
        tab === 'branch' ? branch : tab === 'pr' ? pr.replace(/^#/, '') : ticket.toUpperCase();
      if (!sourceRef) throw new Error('Pick a source');
      const t = await window.sideboard.createThread({
        sourceType,
        sourceRef,
        agent,
        repoPath,
      });
      onCreated(t.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New thread</h3>
        <div className="tab-bar">
          {(['branch', 'pr', 'ticket', 'orchestration'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active primary' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="row">
          <label>Agent</label>
          <select value={agent} onChange={(e) => setAgent(e.target.value as AgentKind)}>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="opencode">opencode</option>
          </select>
          {!agentOk && (
            <span style={{ color: 'var(--err)' }}>
              {agentStatus?.reason ?? 'Agent unavailable'}
            </span>
          )}
        </div>

        {tab === 'branch' && (
          <div className="row">
            <label>Branch</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ flex: 1 }}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.current ? '* ' : ''}
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'pr' && (
          <div className="row">
            <label>PR</label>
            <select value={pr} onChange={(e) => setPr(e.target.value)} style={{ flex: 1 }}>
              <option value="">Select…</option>
              {prs.map((p) => (
                <option key={p.number} value={String(p.number)}>
                  #{p.number} {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'ticket' && (
          <>
            {!ticketOk && (
              <p style={{ color: 'var(--warn)' }}>
                Linear MCP required for ticket sources
                {agentStatus && !agentStatus.linearMcp ? ' (not detected)' : ''}.
              </p>
            )}
            <div className="row">
              <label>Issue</label>
              <select
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                style={{ flex: 1 }}
                disabled={!ticketOk}
              >
                <option value="">Select…</option>
                {issues.map((i) => (
                  <option key={i.id} value={i.identifier}>
                    {i.identifier} {i.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>Or key</label>
              <input
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                placeholder="ABC-123"
                disabled={!ticketOk}
                style={{ flex: 1 }}
              />
            </div>
          </>
        )}

        {tab === 'orchestration' && (
          <div className="row">
            <label>Goal</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Coordinate work across threads…"
              style={{ flex: 1, minHeight: 80 }}
            />
          </div>
        )}

        {error && <p style={{ color: 'var(--err)' }}>{error}</p>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={
              busy ||
              !agentOk ||
              (tab === 'ticket' && !ticketOk) ||
              (tab === 'orchestration' && !goal.trim())
            }
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
