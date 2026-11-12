import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Thread } from '@sideboard-ai/core';
import {
  coerceOrderBoard,
  gatePhrase,
  holdPhrase,
  orderSnapshotFromThread,
  orderTargetMatches,
  planWatchCopy,
  waterfallNodeState,
  type OrderBoard,
  type OrderTarget,
  type OrderTargetKind,
  type WaterfallNode,
} from '@sideboard/order-view';

const KIND_LABEL: Record<OrderTargetKind, string> = {
  pr: 'Pull request',
  issue: 'Issue',
  workspace: 'Workspace',
  orchestration: 'Orchestration',
};

function targetOf(node: WaterfallNode): OrderTarget {
  return {
    kind: node.kind,
    ref: node.ref,
    ...(node.repoPath ? { repoPath: node.repoPath } : {}),
    label: node.label,
  };
}

export function BoardWaterfall({
  threads,
  onOpenThread,
  ownerThreadId,
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
  /** When set, show only the plan owned by this orchestration chat. */
  ownerThreadId?: string;
}) {
  const [board, setBoard] = useState<OrderBoard>({ plans: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addPlanId, setAddPlanId] = useState<string | null>(null);
  const [waitsOnKind, setWaitsOnKind] = useState<OrderTargetKind>('pr');
  const [waitsOnRef, setWaitsOnRef] = useState('');
  const [gate, setGate] = useState<'in-main' | 'in-prod'>('in-prod');
  const [subjectKind, setSubjectKind] = useState<OrderTargetKind>('pr');
  const [subjectRef, setSubjectRef] = useState('');
  const [hold, setHold] = useState<'start' | 'merge'>('merge');
  const [note, setNote] = useState('');

  const reload = useCallback(() => {
    void window.sideboard
      .listOrder()
      .then((next) => {
        setBoard(coerceOrderBoard(next));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    reload();
    return window.sideboard.onOrderChanged(reload);
  }, [reload]);

  function openNode(node: WaterfallNode) {
    const target = targetOf(node);
    const hit = threads.find(
      (thread) =>
        thread.status !== 'archived' &&
        orderTargetMatches(target, orderSnapshotFromThread(thread)),
    );
    if (hit) onOpenThread(hit.id);
  }

  async function mark(id: string, satisfied: boolean) {
    setBusy(id);
    try {
      await window.sideboard.satisfyOrderDependency(id, satisfied);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await window.sideboard.clearOrderDependency(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function addStep(event: FormEvent, planId: string) {
    event.preventDefault();
    setBusy('add');
    try {
      await window.sideboard.setOrderDependency({
        waitsOn: { kind: waitsOnKind, ref: waitsOnRef },
        gate,
        subject: { kind: subjectKind, ref: subjectRef },
        hold,
        note,
        planId,
      });
      setWaitsOnRef('');
      setSubjectRef('');
      setNote('');
      setAddPlanId(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const compact = Boolean(ownerThreadId);
  const plans = ownerThreadId
    ? board.plans.filter((item) => item.plan.ownerThreadId === ownerThreadId)
    : board.plans;

  return (
    <div className={`board-waterfall${compact ? ' is-compact' : ''}`}>
      {compact ? null : (
        <p className="board-waterfall-lead">
          Each orchestration chat has one plan. Open the chat to keep it in the sidebar.
        </p>
      )}
      {error ? <p className="board-waterfall-error">{error}</p> : null}
      {plans.length === 0 ? (
        <div className="board-waterfall-empty">
          <h3>{compact ? 'No plan yet' : 'No plans yet'}</h3>
          <p>
            {compact
              ? 'This chat drafts one with set_plan. It stays in this sidebar.'
              : 'An orchestration agent drafts a plan with set_plan. Each chat keeps its own.'}
          </p>
        </div>
      ) : (
        plans.map((item) => {
          const chains = item.chains;
          const watch = planWatchCopy(chains);
          return (
            <section key={item.plan.id || item.plan.title} className="board-waterfall-plan-block">
              <div className="board-waterfall-plan">
                <span className="board-waterfall-status">
                  {item.plan.status === 'active' ? 'Running' : 'Draft'}
                </span>
                <h3>{item.plan.title}</h3>
                {item.plan.summary ? <p>{item.plan.summary}</p> : null}
                {!compact && item.plan.ownerThreadId ? (
                  <button type="button" onClick={() => onOpenThread(item.plan.ownerThreadId)}>
                    Open chat
                  </button>
                ) : null}
              </div>
              <p className="board-waterfall-lead">{watch}</p>
              {chains.length === 0 ? (
                <p className="board-waterfall-lead">No steps yet.</p>
              ) : (
                chains.map((chain) => (
          <ol key={chain.nodes.map((node) => node.key).join('|')} className="board-waterfall-chain">
            {chain.nodes.map((node) => {
              const openable = threads.some((thread) =>
                orderTargetMatches(targetOf(node), orderSnapshotFromThread(thread)),
              );
              const state = waterfallNodeState(node, chains);
              return (
                <li
                  key={node.key}
                  className="board-waterfall-node"
                  style={{ marginLeft: `${node.depth * (compact ? 16 : 72)}px` }}
                >
                  {node.incoming.map((edge) => (
                    <div key={edge.edgeId} className="board-waterfall-drop">
                      <span>
                        After {edge.fromLabel} is {gatePhrase(edge.gate)}, this {holdPhrase(edge.hold)}
                      </span>
                      <span className={edge.met ? 'is-clear' : 'is-waiting'}>{edge.detail}</span>
                      {edge.note ? <span>{edge.note}</span> : null}
                      <span className="board-waterfall-actions">
                        {edge.gate === 'in-prod' && !edge.met ? (
                          <button
                            type="button"
                            disabled={busy === edge.edgeId}
                            onClick={() => void mark(edge.edgeId, true)}
                          >
                            Mark in production
                          </button>
                        ) : null}
                        {edge.marked ? (
                          <button
                            type="button"
                            disabled={busy === edge.edgeId}
                            onClick={() => void mark(edge.edgeId, false)}
                          >
                            Undo mark
                          </button>
                        ) : null}
                        {!edge.met && edge.gate === 'in-main' ? (
                          <button
                            type="button"
                            disabled={busy === edge.edgeId}
                            onClick={() => void mark(edge.edgeId, true)}
                          >
                            Mark in main
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy === edge.edgeId}
                          onClick={() => void remove(edge.edgeId)}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                  <div
                    className={`board-waterfall-bar${
                      node.incoming.some((edge) => !edge.met)
                        ? ' is-waiting'
                        : node.incoming.length
                          ? ' is-clear'
                          : ''
                    }${openable ? ' is-openable' : ''}`}
                    role={openable ? 'button' : undefined}
                    tabIndex={openable ? 0 : undefined}
                    onClick={() => openNode(node)}
                    onKeyDown={(event) => {
                      if (!openable) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openNode(node);
                      }
                    }}
                  >
                    <span className="board-waterfall-kicker">
                      {KIND_LABEL[node.kind]}
                      {state ? ` · ${state}` : ''}
                    </span>
                    <strong>{node.label}</strong>
                  </div>
                </li>
              );
            })}
          </ol>
                ))
              )}
      <div className="board-waterfall-add">
        <button
          type="button"
          onClick={() => setAddPlanId((current) => (current === item.plan.id ? null : item.plan.id))}
        >
          {addPlanId === item.plan.id ? 'Close' : 'Add a step'}
        </button>
        {addPlanId === item.plan.id ? (
          <form className="board-waterfall-form" onSubmit={(event) => void addStep(event, item.plan.id)}>
            <label>
              Waits on
              <select
                value={waitsOnKind}
                onChange={(event) => setWaitsOnKind(event.target.value as OrderTargetKind)}
              >
                <option value="pr">Pull request</option>
                <option value="issue">Issue</option>
                <option value="workspace">Workspace</option>
                <option value="orchestration">Orchestration</option>
              </select>
            </label>
            <label>
              Ref
              <input
                value={waitsOnRef}
                onChange={(event) => setWaitsOnRef(event.target.value)}
                placeholder={waitsOnKind === 'pr' ? '12' : waitsOnKind === 'issue' ? 'ENG-4' : 'chat id'}
                required
              />
            </label>
            <label>
              Gate
              <select
                value={gate}
                onChange={(event) => setGate(event.target.value as 'in-main' | 'in-prod')}
              >
                <option value="in-main">In main</option>
                <option value="in-prod">In production</option>
              </select>
            </label>
            <label>
              Then
              <select
                value={subjectKind}
                onChange={(event) => setSubjectKind(event.target.value as OrderTargetKind)}
              >
                <option value="pr">Pull request</option>
                <option value="issue">Issue</option>
                <option value="workspace">Workspace</option>
                <option value="orchestration">Orchestration</option>
              </select>
            </label>
            <label>
              Ref
              <input
                value={subjectRef}
                onChange={(event) => setSubjectRef(event.target.value)}
                placeholder={subjectKind === 'pr' ? '18' : subjectKind === 'issue' ? 'ENG-9' : 'chat id'}
                required
              />
            </label>
            <label>
              Can
              <select
                value={hold}
                onChange={(event) => setHold(event.target.value as 'start' | 'merge')}
              >
                <option value="merge">Merge</option>
                <option value="start">Start</option>
              </select>
            </label>
            <label className="board-waterfall-note">
              Note
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <div className="board-waterfall-submit">
              <button type="submit" className="primary" disabled={busy === 'add'}>
                Add to planner
              </button>
            </div>
          </form>
        ) : null}
      </div>
            </section>
          );
        })
      )}
    </div>
  );
}

export function PlanSidebar({
  threadId,
  threads,
  onOpenThread,
}: {
  threadId: string;
  threads: Thread[];
  onOpenThread: (id: string) => void;
}) {
  return (
    <aside className="plan-sidebar">
      <BoardWaterfall threads={threads} onOpenThread={onOpenThread} ownerThreadId={threadId} />
    </aside>
  );
}
