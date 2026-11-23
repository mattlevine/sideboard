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
import { orderTargetMatches, targetKey } from './order-model.js';
import { gatePhrase, holdPhrase, planWatchCopy } from './order-board.js';

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

/** One pull request, issue, workspace, or orchestration chat on a plan. */
export interface PlanWork {
  target: OrderTarget;
  label: string;
  detail: string;
}

/**
 * Work this plan can start now, work held from starting, and work that may
 * proceed but must not merge. A root that others wait on is in `start` until
 * it reaches that gate. `hold=merge` does not keep the later step from starting.
 * A loop does not block the first pass.
 */
export function executionSlice(rows: OrderRow[]): {
  start: PlanWork[];
  waiting: PlanWork[];
  mergeHeld: PlanWork[];
} {
  const byKey = new Map<
    string,
    {
      target: OrderTarget;
      label: string;
      depth: number;
      asSubject: boolean;
      incoming: OrderRow[];
      outgoing: OrderRow[];
    }
  >();
  const touch = (target: OrderTarget, label: string, depth: number, asSubject: boolean) => {
    const key = targetKey(target);
    const found = byKey.get(key);
    if (!found) {
      byKey.set(key, {
        target,
        label,
        depth: asSubject ? depth : Number.POSITIVE_INFINITY,
        asSubject,
        incoming: [],
        outgoing: [],
      });
      return;
    }
    if (asSubject || !found.asSubject) found.label = label;
    if (asSubject) {
      found.asSubject = true;
      found.depth = Math.min(found.depth, depth);
    }
  };
  for (const row of rows) {
    touch(row.subject, row.subjectLabel, row.depth, true);
    touch(row.waitsOn, row.waitsOnLabel, row.depth, false);
    if (row.loop) continue;
    byKey.get(targetKey(row.subject))!.incoming.push(row);
    byKey.get(targetKey(row.waitsOn))!.outgoing.push(row);
  }
  const start: PlanWork[] = [];
  const waiting: PlanWork[] = [];
  const mergeHeld: PlanWork[] = [];
  const gateName = (row: OrderRow) => (row.gate === 'in-prod' ? 'in prod' : 'in main');
  const items = [...byKey.values()].sort((a, b) => {
    const depthA = Number.isFinite(a.depth) ? a.depth : 0;
    const depthB = Number.isFinite(b.depth) ? b.depth : 0;
    return depthA - depthB || a.label.localeCompare(b.label);
  });
  for (const item of items) {
    const startBlocked = item.incoming.filter((row) => !row.met && row.hold === 'start');
    const mergeBlocked = item.incoming.filter((row) => !row.met && row.hold === 'merge');
    const settled =
      item.outgoing.length > 0 &&
      item.outgoing.every((row) => row.met) &&
      startBlocked.length === 0 &&
      mergeBlocked.length === 0;
    if (startBlocked.length > 0) {
      const edge = startBlocked[0]!;
      waiting.push({
        target: item.target,
        label: item.label,
        detail: `${edge.waitsOnLabel} must be ${gateName(edge)} before this can start`,
      });
    } else if (!settled) {
      const pending = item.outgoing.find((row) => !row.met);
      start.push({
        target: item.target,
        label: item.label,
        detail: pending
          ? `Start this so it can reach ${pending.gate === 'in-prod' ? 'production' : 'main'}`
          : 'Start this',
      });
    }
    if (mergeBlocked.length > 0) {
      const edge = mergeBlocked[0]!;
      mergeHeld.push({
        target: item.target,
        label: item.label,
        detail: `Do not merge until ${edge.waitsOnLabel} is ${gateName(edge)}`,
      });
    }
  }
  return { start, waiting, mergeHeld };
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
  if (plan?.status === 'active') {
    const slice = executionSlice(rows);
    const section = (title: string, items: PlanWork[]) => {
      if (!items.length) return;
      lines.push('', title);
      for (const item of items) lines.push(`- ${item.label}. ${item.detail}`);
    };
    section('Start now:', slice.start);
    section('Do not start:', slice.waiting);
    section('Do not merge:', slice.mergeHeld);
  }
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

/** How a diagram row should look: start it, it is held, or the gate is clear. */
function waterfallBar(node: WaterfallNode, chain: WaterfallChain): string {
  const gating = node.incoming.filter((edge) => !edge.loop);
  const startBlocked = gating.some((edge) => !edge.met && edge.hold === 'start');
  const outgoing = chain.nodes
    .flatMap((other) => other.incoming)
    .filter((edge) => edge.fromKey === node.key && !edge.loop);
  const settled = outgoing.length > 0 && outgoing.every((edge) => edge.met) && !startBlocked;
  if (startBlocked) return ' waiting';
  if (settled || (gating.length > 0 && gating.every((edge) => edge.met))) return ' clear';
  return ' start';
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
  const watch = chains.length ? planWatchCopy(chains) : '';
  const status = plan
    ? plan.status === 'active'
      ? watch || 'Running. Start the steps that are free. Leave held steps alone.'
      : watch
        ? `Draft. Nothing runs until you agree. ${watch}`
        : 'Draft. Discuss this and change it. Nothing runs until you agree.'
    : watch ||
      'Later steps wait until the one above reaches its gate. In main clears when that pull request is merged. In production stays waiting until it is marked.';
  const body =
    chains.length === 0
      ? '<p class="empty">No order yet.</p>'
      : chains
          .map((chain) => {
            const nodes = chain.nodes
              .map((node) => {
                const yours = nodeIsYou(node, you);
                const working = node.working === true;
                const bar = waterfallBar(node, chain);
                const state = `${working ? ' current' : ''}${bar}${yours ? ' you' : ''}`;
                const drops = node.incoming
                  .map((edge) => {
                    const tone = edge.loop ? 'loop' : edge.met ? 'clear' : 'waiting';
                    const note = edge.note ? `<span>${escapeHtml(edge.note)}</span>` : '';
                    return `<div class="drop"><span>After ${escapeHtml(edge.fromLabel)} is ${escapeHtml(gatePhrase(edge.gate))}, this ${escapeHtml(holdPhrase(edge.hold))}</span><span class="${tone}">${escapeHtml(edge.detail)}</span>${note}</div>`;
                  })
                  .join('');
                const kicker = `${WATERFALL_KIND[node.kind]}${bar === ' start' ? ' · Start' : ''}${working ? ' · Working' : ''}${yours ? ' · You' : ''}`;
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
.bar.start { border-color: #2a4a7a; background: #141c28; }
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
