import type {
  OrderPlan,
  OrderTargetKind,
  OrderTarget,
  OrderEdge,
  OrderThreadSnapshot,
  OrderRow,
  WaterfallNode,
  WaterfallChain,
} from './order-model.js';
import {
  orderTargetMatches,
} from './order-model.js';
import { gatePhrase, holdPhrase } from './order-board.js';

/** Steps this checkout is waiting on, ready for, or blocking. */
export function formatOrderPlace(rows: OrderRow[], you: OrderThreadSnapshot): string {
  const mine = (target: OrderTarget) => orderTargetMatches(target, you);
  const waitingOn = rows.filter((row) => mine(row.subject) && !row.met && !row.loop);
  const looping = rows.filter((row) => mine(row.subject) && row.loop && !row.met);
  const ready = rows.filter((row) => mine(row.subject) && row.met);
  const blocking = rows.filter((row) => mine(row.waitsOn) && !row.met && !row.loop);
  if (!waitingOn.length && !looping.length && !ready.length && !blocking.length) {
    return 'This checkout is not in the planner. set_dependency records what you wait on (omit subject). clear_dependency removes a step you are part of.';
  }
  const gate = (row: OrderRow) => (row.gate === 'in-prod' ? 'in prod' : 'in main');
  const lines = ['Where you are in the planner:'];
  for (const row of waitingOn) {
    lines.push(
      `- Waiting: ${row.waitsOnLabel} must be ${gate(row)} before you can ${row.hold}. id: ${row.id.slice(0, 8)}`,
    );
  }
  for (const row of looping) {
    lines.push(
      `- Loop: returns to ${row.waitsOnLabel} once you are ${gate(row)}. The first pass is not blocked. id: ${row.id.slice(0, 8)}`,
    );
  }
  for (const row of ready) {
    lines.push(`- Clear: you can ${row.hold}. ${row.detail}. id: ${row.id.slice(0, 8)}`);
  }
  for (const row of blocking) {
    lines.push(
      `- Blocking: ${row.subjectLabel} cannot ${row.hold} until you are ${gate(row)}. id: ${row.id.slice(0, 8)}`,
    );
  }
  return lines.join('\n');
}

export function executionSlice(rows: OrderRow[]): { ready: OrderRow[]; waiting: OrderRow[] } {
  return {
    ready: rows.filter((row) => row.met || row.loop),
    waiting: rows.filter((row) => !row.met && !row.loop),
  };
}

export function orderEdgeTouches(edge: Pick<OrderEdge, 'waitsOn' | 'subject'>, you: OrderThreadSnapshot): boolean {
  return orderTargetMatches(edge.subject, you) || orderTargetMatches(edge.waitsOn, you);
}

export function formatOrderText(rows: OrderRow[], plan?: OrderPlan | null): string {
  if (rows.length === 0) {
    if (plan) {
      const goal = plan.goal ? ` Goal: ${plan.goal}.` : '';
      const summary = plan.summary ? ` ${plan.summary}` : '';
      return `Plan “${plan.title}” is ${plan.status}.${goal}${summary} No steps yet. set_dependency records each gate.`.replace(/\s+/g, ' ').trim();
    }
    return 'No orchestration plan yet. set_dependency records an order — for example PR 1 in prod before PR 2 can merge, or PR 3 in main before issue 4 can start. The Orchestration row in the sidebar opens that chat.';
  }
  const lines = [
    plan
      ? `Plan “${plan.title}” is ${plan.status}. ${plan.goal ? `Goal: ${plan.goal}. ` : ''}${plan.summary}`.trim()
      : 'Orchestration. Steps can wait on a gate or loop back to an earlier step. in-main clears when that PR is merged. in-prod stays waiting until satisfy_dependency.',
    '',
  ];
  rows.forEach((row, index) => {
    const gate = row.gate === 'in-prod' ? 'in prod' : 'in main';
    const hold = row.hold === 'merge' ? 'merge' : 'start';
    const state = row.loop ? 'loop' : row.met ? 'clear' : 'waiting';
    lines.push(
      row.loop
        ? `${index + 1}. ${state}  ${row.subjectLabel} returns to ${row.waitsOnLabel} once it is ${gate}`
        : `${index + 1}. ${state}  ${row.waitsOnLabel} must be ${gate} before ${row.subjectLabel} can ${hold}`,
    );
    lines.push(`   ${row.detail}`);
    if (row.note) lines.push(`   ${row.note}`);
    lines.push(`   id: ${row.id.slice(0, 8)}`);
  });
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const WATERFALL_KIND: Record<OrderTargetKind, string> = {
  pr: 'Pull request',
  issue: 'Issue',
  workspace: 'Workspace',
  orchestration: 'Orchestration',
};

/** Flag steps whose chat is running or queued so the diagram can mark them. */
export function markWorkingChains(
  chains: WaterfallChain[],
  threads: OrderThreadSnapshot[],
): WaterfallChain[] {
  const active = threads.filter(
    (thread) => thread.status === 'running' || thread.status === 'queued',
  );
  if (active.length === 0) return chains;
  return chains.map((chain) => ({
    nodes: chain.nodes.map((node) => {
      const working = active.some((thread) =>
        orderTargetMatches(
          {
            kind: node.kind,
            ref: node.ref,
            ...(node.repoPath ? { repoPath: node.repoPath } : {}),
          },
          thread,
        ),
      );
      return working ? { ...node, working: true } : node;
    }),
  }));
}

function nodeIsYou(node: WaterfallNode, you: OrderThreadSnapshot | null | undefined): boolean {
  if (!you) return false;
  return orderTargetMatches(
    {
      kind: node.kind,
      ref: node.ref,
      ...(node.repoPath ? { repoPath: node.repoPath } : {}),
    },
    you,
  );
}

/** Side-column document. `show_plan` returns this so the desktop opens it. */
export function formatWaterfallHtml(
  chains: WaterfallChain[],
  opts?: { plan?: OrderPlan | null; you?: OrderThreadSnapshot | null },
): string {
  const plan = opts?.plan ?? null;
  const you = opts?.you ?? null;
  const title = plan?.title?.trim() || 'Planner';
  const status = plan
    ? plan.status === 'active'
      ? 'Running. Ready steps can start. Waiting steps stay held.'
      : 'Draft. Discuss this and change it. Nothing runs until you agree.'
    : 'Later steps wait until the one above reaches its gate. In main clears when that pull request is merged. In production stays waiting until it is marked.';
  const body =
    chains.length === 0
      ? '<p class="empty">No order yet.</p>'
      : chains
          .map((chain) => {
            const nodes = chain.nodes
              .map((node) => {
                const waiting = node.incoming.some((edge) => !edge.met && !edge.loop);
                const clear = node.incoming.some((edge) => !edge.loop) && !waiting;
                const yours = nodeIsYou(node, you);
                const working = node.working === true;
                const state = `${waiting ? ' waiting' : clear ? ' clear' : ''}${yours ? ' you' : ''}${working ? ' current' : ''}`;
                const drops = node.incoming
                  .map((edge) => {
                    const tone = edge.loop ? 'loop' : edge.met ? 'clear' : 'waiting';
                    const note = edge.note ? `<span>${escapeHtml(edge.note)}</span>` : '';
                    return `<div class="drop"><span>After ${escapeHtml(edge.fromLabel)} is ${escapeHtml(gatePhrase(edge.gate))}, this ${escapeHtml(holdPhrase(edge.hold))}</span><span class="${tone}">${escapeHtml(edge.detail)}</span>${note}</div>`;
                  })
                  .join('');
                const kicker = `${WATERFALL_KIND[node.kind]}${working ? ' · Working' : ''}${yours ? ' · You' : ''}`;
                return `<li class="node" style="margin-left:${node.depth * 28}px">${drops}<div class="bar${state}"><span class="kicker">${kicker}</span><strong>${escapeHtml(node.label)}</strong></div></li>`;
              })
              .join('');
            return `<ol class="chain">${nodes}</ol>`;
          })
          .join('');
  const summary = plan?.summary?.trim()
    ? `<p class="lead">${escapeHtml(plan.summary.trim())}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 20px 22px 32px; background: #141414; color: #ececec; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
h1 { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
.lead, .empty, .status { color: #9a9a9a; margin: 0 0 18px; max-width: 62ch; }
.chain { list-style: none; margin: 0 0 28px; padding: 0; }
.drop { margin: 0 0 0 16px; padding: 8px 0 8px 12px; border-left: 1px solid #333; color: #9a9a9a; font-size: 12px; display: flex; flex-direction: column; gap: 3px; }
.drop .waiting { color: #e2b340; }
.drop .clear, .drop .loop { color: #6fbf73; }
.bar { border: 1px solid #333; border-radius: 10px; padding: 10px 12px; background: #1c1c1c; display: flex; flex-direction: column; gap: 2px; }
.bar.waiting { border-color: #6a5420; background: #221c10; }
.bar.clear { border-color: #2d5a32; background: #142016; }
.bar.you { outline: 1px solid #8ab4ff; }
.bar.current { border-color: #8ab4ff; box-shadow: inset 3px 0 0 #8ab4ff; }
.bar.current .kicker { color: #ececec; }
.kicker { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #9a9a9a; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="status">${escapeHtml(status)}</p>
${summary}
${body}
</body>
</html>`;
}

export interface ShowPlanDocument {
  title: string;
  type: 'html' | 'markdown';
  artifact_id: 'plan' | 'checkout-plan';
  content: string;
}

/** First heading in a checkout implementation plan, or a plain fallback. */
export function checkoutPlanTitle(markdown: string): string {
  const match = /^#{1,6}[ \t]+(.+?)[ \t]*$/m.exec(markdown);
  const title = match?.[1]?.replace(/\s+#+\s*$/, '').trim() ?? '';
  return title.slice(0, 80) || 'Implementation plan';
}

/**
 * Documents `show_plan` opens. The checkout implementation plan comes first.
 * The orchestration diagram is last so it is the active tab when both exist.
 */
export function showPlanDocuments(input: {
  diagramTitle?: string | null;
  diagramHtml?: string | null;
  checkoutMarkdown?: string | null;
}): ShowPlanDocument[] {
  const docs: ShowPlanDocument[] = [];
  const markdown = input.checkoutMarkdown ?? '';
  if (markdown.trim()) {
    docs.push({
      title: checkoutPlanTitle(markdown),
      type: 'markdown',
      artifact_id: 'checkout-plan',
      content: markdown,
    });
  }
  const html = input.diagramHtml ?? '';
  if (html.trim()) {
    docs.push({
      title: input.diagramTitle?.trim() || 'Planner',
      type: 'html',
      artifact_id: 'plan',
      content: html,
    });
  }
  return docs;
}

export function showPlanMessage(docs: ShowPlanDocument[], worktree: boolean): string {
  const diagram = docs.some((doc) => doc.artifact_id === 'plan');
  const checkout = docs.some((doc) => doc.artifact_id === 'checkout-plan');
  if (diagram && checkout) {
    return "Opened the orchestration plan and this checkout's implementation plan.";
  }
  if (checkout) return "Opened this checkout's implementation plan.";
  return worktree
    ? 'Opened the orchestration plan in the side column, with this checkout marked.'
    : 'Opened the plan in the side column.';
}
