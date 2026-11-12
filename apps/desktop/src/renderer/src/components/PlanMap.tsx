import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { SidebarToggle } from './SidebarToggle';
import {
  buildPlanMap,
  coerceOrderBoard,
  type OrderBoard,
  type PlanMapLink,
  type PlanMapNode,
} from '@sideboard/order-view';

const CARD_W = 220;
const CARD_H = 112;
const GAP_X = 96;
const GAP_Y = 24;

export function OrchestrationView({
  threads,
  onOpenThread,
  onNewOrchestration,
  leftSidebarOpen,
  onToggleLeftSidebar,
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
  onNewOrchestration: () => void;
  leftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
}) {
  return (
    <section className="panel board">
      {!leftSidebarOpen && (
        <div className="board-chrome">
          <SidebarToggle side="left" open={false} onClick={onToggleLeftSidebar} />
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <h2>Orchestration</h2>
        <div className="actions">
          <button type="button" onClick={onNewOrchestration} title="Start a new orchestration agent">
            New orchestration
          </button>
        </div>
      </div>
      <div className="board-body">
        <PlanMap threads={threads} onOpenThread={onOpenThread} />
      </div>
    </section>
  );
}

export function PlanMap({
  threads,
  onOpenThread,
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
}) {
  const [board, setBoard] = useState<OrderBoard>({ plans: [] });
  const [error, setError] = useState<string | null>(null);

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

  const map = useMemo(
    () =>
      buildPlanMap(
        board.plans,
        threads.map((thread) => ({ id: thread.id, parentThreadId: thread.parentThreadId })),
      ),
    [board.plans, threads],
  );

  const laid = useMemo(() => layout(map.nodes, map.links), [map]);

  return (
    <div className="plan-map">
      {error ? <p className="board-waterfall-error">{error}</p> : null}
      {map.nodes.length === 0 ? (
        <div className="board-waterfall-empty">
          <h3>No plans yet</h3>
          <p>An orchestration chat drafts its plan with set_plan. A step can be another orchestration chat, and that chat drafts its own.</p>
        </div>
      ) : (
        <div className="plan-map-canvas" style={{ width: laid.width, height: laid.height }}>
          <svg className="plan-map-lines" width={laid.width} height={laid.height}>
            {laid.lines.map((line) => (
              <g key={line.key}>
                <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                <text x={(line.x1 + line.x2) / 2} y={(line.y1 + line.y2) / 2 - 6}>
                  {line.label}
                </text>
              </g>
            ))}
          </svg>
          {map.nodes.map((node) => {
            const pos = laid.positions.get(node.id);
            if (!pos) return null;
            const openable = Boolean(
              node.ownerThreadId && threads.some((thread) => thread.id === node.ownerThreadId),
            );
            const body = (
              <>
                <span className="board-waterfall-status">
                  {node.status === 'active' ? 'Running' : 'Draft'}
                </span>
                <strong>{node.title}</strong>
                <span>
                  {node.steps === 0
                    ? 'No steps yet'
                    : `${node.steps} step${node.steps === 1 ? '' : 's'}${
                        node.waiting ? ` · ${node.waiting} waiting` : ''
                      }`}
                </span>
              </>
            );
            const style = { left: pos.x, top: pos.y, width: CARD_W, height: CARD_H };
            if (!openable) {
              return (
                <div key={node.id} className="plan-map-card" style={style}>
                  {body}
                </div>
              );
            }
            return (
              <button
                key={node.id}
                type="button"
                className="plan-map-card is-openable"
                style={style}
                onClick={() => onOpenThread(node.ownerThreadId)}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function layout(nodes: PlanMapNode[], links: PlanMapLink[]) {
  const columns = new Map<number, PlanMapNode[]>();
  for (const node of nodes) {
    const list = columns.get(node.depth) ?? [];
    list.push(node);
    columns.set(node.depth, list);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const depths = [...columns.keys()].sort((a, b) => a - b);
  depths.forEach((depth, column) => {
    const list = columns.get(depth) ?? [];
    list.forEach((node, row) => {
      positions.set(node.id, {
        x: column * (CARD_W + GAP_X),
        y: row * (CARD_H + GAP_Y),
      });
    });
  });
  const width = Math.max(CARD_W, depths.length * (CARD_W + GAP_X) - GAP_X);
  const tallest = Math.max(1, ...[...columns.values()].map((list) => list.length));
  const height = tallest * (CARD_H + GAP_Y) - GAP_Y;
  const lines = links.flatMap((link) => {
    const from = positions.get(link.fromId);
    const to = positions.get(link.toId);
    if (!from || !to) return [];
    return [
      {
        key: `${link.fromId}->${link.toId}`,
        x1: from.x + CARD_W,
        y1: from.y + CARD_H / 2,
        x2: to.x,
        y2: to.y + CARD_H / 2,
        label: link.label,
      },
    ];
  });
  return { positions, lines, width, height };
}
