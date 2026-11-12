/**
 * Fleet order of operations. A step waits until an earlier PR, issue, or
 * workspace reaches a gate (in main, or in production) before it can start
 * or merge. The sidebar Orchestration item draws the map of these plans.
 * Pure: no filesystem. The store in `order.ts` persists the edges.
 */

export type OrderPlanStatus = 'draft' | 'active';

export interface OrderPlan {
  id: string;
  /** Orchestration chat this plan belongs to. */
  ownerThreadId: string;
  title: string;
  summary: string;
  /** Draft is for discussion. Active means the user agreed to run it. */
  status: OrderPlanStatus;
  updatedAt: string;
}

export type OrderGate = 'in-main' | 'in-prod';
export type OrderHold = 'start' | 'merge';
export type OrderTargetKind = 'pr' | 'issue' | 'workspace' | 'orchestration';

export interface OrderTarget {
  kind: OrderTargetKind;
  /** PR number, issue id (ENG-12), or a workspace chat id / worktree path. */
  ref: string;
  repoPath?: string;
  label?: string;
}

export interface OrderEdge {
  id: string;
  /** {@link OrderPlan.id}. Empty on edges built before plans were per chat. */
  planId?: string;
  waitsOn: OrderTarget;
  gate: OrderGate;
  subject: OrderTarget;
  hold: OrderHold;
  note: string;
  createdByThreadId: string | null;
  createdAt: string;
}

export interface OrderMark {
  /** {@link targetKey} of the step that reached the gate. */
  key: string;
  gate: OrderGate;
  at: string;
}

/** Live or archived checkout, enough to tell whether a gate is met. */
export interface OrderThreadSnapshot {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  repoPath: string;
  worktreePath: string;
  prUrl: string | null;
  prState: string | null;
  prTitle: string | null;
  status: string;
  /** Orchestration chat that opened this one, when it was spawned from a plan. */
  parentThreadId?: string | null;
}

export interface OrderRow {
  id: string;
  waitsOn: OrderTarget;
  subject: OrderTarget;
  gate: OrderGate;
  hold: OrderHold;
  note: string;
  /** Subject depth. Roots that nothing waits on are 1 for the first dependent. */
  depth: number;
  met: boolean;
  /** True when a person or agent marked the gate, rather than a merged PR. */
  marked: boolean;
  detail: string;
  waitsOnLabel: string;
  subjectLabel: string;
  /** Live chat for the subject, when one is on the board. */
  chatId?: string;
}

export interface WaterfallIncoming {
  edgeId: string;
  /** {@link targetKey} of the step this one waits on. */
  fromKey: string;
  gate: OrderGate;
  hold: OrderHold;
  met: boolean;
  marked: boolean;
  detail: string;
  fromLabel: string;
  note: string;
}

export interface WaterfallNode {
  key: string;
  label: string;
  kind: OrderTargetKind;
  ref: string;
  repoPath?: string;
  depth: number;
  incoming: WaterfallIncoming[];
  /** Live chat for this step, when one is on the board. */
  chatId?: string;
  chatTitle?: string;
}

export interface WaterfallChain {
  nodes: WaterfallNode[];
}

export function parseOrderGate(value: string): OrderGate {
  const s = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === 'inmain' || s === 'main' || s === 'merged') return 'in-main';
  if (s === 'inprod' || s === 'prod' || s === 'production') return 'in-prod';
  throw new Error('gate must be in-main or in-prod');
}

export function parseOrderHold(value: string): OrderHold {
  const s = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === 'start' || s === 'beforestart') return 'start';
  if (s === 'merge' || s === 'beforemerge') return 'merge';
  throw new Error('hold must be start or merge');
}

export function parseOrderKind(value: string): OrderTargetKind {
  const s = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === 'pr' || s === 'pull' || s === 'pullrequest') return 'pr';
  if (s === 'issue' || s === 'ticket' || s === 'task') return 'issue';
  if (s === 'workspace' || s === 'worktree' || s === 'checkout') return 'workspace';
  if (s === 'orchestration' || s === 'orchestrator' || s === 'agent') return 'orchestration';
  throw new Error('kind must be pr, issue, workspace, or orchestration');
}

export function normalizeOrderTarget(input: {
  kind: string;
  ref: string;
  repoPath?: string | null;
  label?: string | null;
}): OrderTarget {
  const kind = parseOrderKind(input.kind);
  const raw = input.ref.trim();
  if (!raw) throw new Error(`${kind} ref is required`);
  let ref = raw;
  if (kind === 'pr') {
    const match = raw.match(/(\d+)/);
    if (!match) throw new Error('PR ref must be a number');
    ref = match[1]!;
  } else if (kind === 'issue') {
    ref = raw.replace(/^#/, '');
  }
  const repoPath = input.repoPath?.trim().replace(/\/+$/, '') || undefined;
  const label = input.label?.trim() || undefined;
  const target: OrderTarget = { kind, ref };
  if (repoPath) target.repoPath = repoPath;
  if (label) target.label = label;
  return target;
}

export function targetKey(target: OrderTarget): string {
  const ref = target.ref.trim().replace(/^#/, '').toLowerCase();
  const repo = (target.repoPath ?? '').replace(/\/+$/, '').toLowerCase();
  if (target.kind === 'issue' && !repo) return `issue:${ref}`;
  if (target.kind === 'orchestration') return `orchestration:${ref}`;
  return `${target.kind}:${repo}:${ref}`;
}

function samePath(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}

function repoMatches(target: OrderTarget, thread: OrderThreadSnapshot): boolean {
  if (!target.repoPath || !thread.repoPath) return true;
  return samePath(target.repoPath, thread.repoPath);
}

export function orderPrNumber(thread: {
  sourceType: string;
  sourceRef: string;
  prUrl: string | null;
}): number | null {
  if (thread.sourceType === 'pr') {
    const n = Number(String(thread.sourceRef).replace(/^#/, ''));
    if (Number.isInteger(n) && n >= 1) return n;
  }
  const match = (thread.prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$|[?#])/i);
  return match ? Number(match[1]) : null;
}

export function orderTargetMatches(
  target: OrderTarget,
  thread: OrderThreadSnapshot,
): boolean {
  if (!repoMatches(target, thread)) return false;
  if (target.kind === 'pr') {
    const n = Number(target.ref);
    return Number.isInteger(n) && orderPrNumber(thread) === n;
  }
  if (target.kind === 'issue') {
    if (thread.sourceType !== 'ticket') return false;
    return thread.sourceRef.trim().replace(/^#/, '').toLowerCase() === target.ref.trim().toLowerCase();
  }
  if (target.kind === 'orchestration') {
    const orchestrator =
      thread.sourceType === 'orchestration' || thread.repoPath === '__global__';
    if (!orchestrator) return false;
    const ref = target.ref.trim();
    if (thread.id === ref) return true;
    return ref.length >= 8 && !ref.includes('/') && thread.id.startsWith(ref);
  }
  const ref = target.ref.trim();
  if (thread.id === ref) return true;
  if (thread.worktreePath && samePath(thread.worktreePath, ref)) return true;
  return ref.length >= 8 && !ref.includes('/') && thread.id.startsWith(ref);
}

export function orderSnapshotFromThread(thread: {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  repoPath: string;
  worktreePath: string;
  prUrl?: string | null;
  prState?: string | null;
  prTitle?: string | null;
  status: string;
  parentThreadId?: string | null;
}): OrderThreadSnapshot {
  return {
    id: thread.id,
    title: thread.title,
    sourceType: thread.sourceType,
    sourceRef: thread.sourceRef,
    repoPath: thread.repoPath,
    worktreePath: thread.worktreePath,
    prUrl: thread.prUrl ?? null,
    prState: thread.prState ?? null,
    prTitle: thread.prTitle ?? null,
    status: thread.status,
    parentThreadId:
      'parentThreadId' in thread ? (thread.parentThreadId ?? null) : null,
  };
}

/** What a worktree agent means when it omits the subject: this checkout. */
export function defaultOrderSubject(
  thread: OrderThreadSnapshot,
  hold: OrderHold,
): OrderTarget {
  const pr = orderPrNumber(thread);
  if (hold === 'merge' && pr) {
    const target: OrderTarget = {
      kind: 'pr',
      ref: String(pr),
      label: thread.prTitle || thread.title,
    };
    if (thread.repoPath) target.repoPath = thread.repoPath;
    return target;
  }
  if (hold === 'start' && thread.sourceType === 'ticket' && thread.sourceRef.trim()) {
    const target: OrderTarget = {
      kind: 'issue',
      ref: thread.sourceRef.trim().replace(/^#/, ''),
      label: thread.title,
    };
    if (thread.repoPath) target.repoPath = thread.repoPath;
    return target;
  }
  const target: OrderTarget = {
    kind: 'workspace',
    ref: thread.worktreePath || thread.id,
    label: thread.title,
  };
  if (thread.repoPath) target.repoPath = thread.repoPath;
  return target;
}

export function assertCallerOwnsSubject(
  caller: OrderThreadSnapshot,
  subject: OrderTarget,
): void {
  if (!orderTargetMatches(subject, caller)) {
    throw new Error(
      'This checkout can only set a dependency on its own workspace, PR, or ticket.',
    );
  }
}

function shortName(target: OrderTarget): string {
  if (target.label?.trim()) return target.label.trim();
  if (target.kind === 'pr') return `PR #${target.ref}`;
  if (target.kind === 'issue') return target.ref;
  if (target.kind === 'orchestration') return 'that orchestration';
  return 'that workspace';
}

export function dependencyIdentity(edge: Pick<OrderEdge, 'waitsOn' | 'gate' | 'subject' | 'hold'>): string {
  return `${targetKey(edge.waitsOn)}|${edge.gate}|${targetKey(edge.subject)}|${edge.hold}`;
}

export function dependencyWouldCycle(
  edges: OrderEdge[],
  next: Pick<OrderEdge, 'waitsOn' | 'subject'>,
): boolean {
  const start = targetKey(next.subject);
  const goal = targetKey(next.waitsOn);
  if (start === goal) return true;
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const from = targetKey(edge.waitsOn);
    const to = targetKey(edge.subject);
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nextKey of adj.get(cur) ?? []) stack.push(nextKey);
  }
  return false;
}

export function cycleDependencyMessage(
  next: Pick<OrderEdge, 'waitsOn' | 'subject'>,
): string {
  if (targetKey(next.subject) === targetKey(next.waitsOn)) {
    return 'A step cannot wait on itself.';
  }
  return `That dependency loops: ${shortName(next.subject)} already has to finish before ${shortName(next.waitsOn)}.`;
}

function subjectDepths(edges: OrderEdge[]): Map<string, number> {
  const depth = new Map<string, number>();
  const touch = (key: string) => {
    if (!depth.has(key)) depth.set(key, 0);
  };
  for (const edge of edges) {
    touch(targetKey(edge.waitsOn));
    touch(targetKey(edge.subject));
  }
  for (let pass = 0; pass < depth.size; pass++) {
    let changed = false;
    for (const edge of edges) {
      const from = targetKey(edge.waitsOn);
      const to = targetKey(edge.subject);
      const next = (depth.get(from) ?? 0) + 1;
      if (next > (depth.get(to) ?? 0)) {
        depth.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

function threadFor(
  target: OrderTarget,
  threads: OrderThreadSnapshot[],
): OrderThreadSnapshot | undefined {
  const live = threads.filter((thread) => thread.status !== 'archived');
  return (
    live.find((thread) => orderTargetMatches(target, thread)) ??
    threads.find((thread) => orderTargetMatches(target, thread))
  );
}

export function orderTargetLabel(
  target: OrderTarget,
  threads: OrderThreadSnapshot[],
): string {
  const hit = threadFor(target, threads);
  if (target.kind === 'pr') {
    const title = target.label?.trim() || hit?.prTitle?.trim() || '';
    const base = `PR #${target.ref}`;
    return title && title !== base ? `${base} · ${title}` : base;
  }
  if (target.kind === 'issue') {
    const title =
      target.label?.trim() ||
      (hit?.sourceType === 'ticket' ? hit.title.trim() : '');
    return title && title !== target.ref ? `${target.ref} · ${title}` : target.ref;
  }
  if (target.kind === 'orchestration') {
    return target.label?.trim() || hit?.title?.trim() || 'Orchestration';
  }
  return target.label?.trim() || hit?.title?.trim() || 'Workspace';
}

function prMerged(target: OrderTarget, threads: OrderThreadSnapshot[]): boolean {
  return threads.some(
    (thread) =>
      orderTargetMatches(target, thread) &&
      (thread.prState ?? '').toUpperCase() === 'MERGED',
  );
}

export function orderGateStatus(
  edge: Pick<OrderEdge, 'waitsOn' | 'gate'>,
  threads: OrderThreadSnapshot[],
  marks: OrderMark[],
): { met: boolean; marked: boolean; detail: string } {
  const key = targetKey(edge.waitsOn);
  const marked = marks.some((mark) => mark.key === key && mark.gate === edge.gate);
  if (edge.gate === 'in-prod') {
    return marked
      ? { met: true, marked: true, detail: 'marked in production' }
      : { met: false, marked: false, detail: 'waiting to be marked in production' };
  }
  if (marked) return { met: true, marked: true, detail: 'marked in main' };
  if (prMerged(edge.waitsOn, threads)) {
    return { met: true, marked: false, detail: 'merged to main' };
  }
  const known = threads.some((thread) => orderTargetMatches(edge.waitsOn, thread));
  return known
    ? { met: false, marked: false, detail: 'open — not in main' }
    : { met: false, marked: false, detail: 'not on the board yet' };
}

export function resolveOrderRows(
  edges: OrderEdge[],
  threads: OrderThreadSnapshot[],
  marks: OrderMark[] = [],
): OrderRow[] {
  const depths = subjectDepths(edges);
  return edges
    .map((edge) => {
      const status = orderGateStatus(edge, threads, marks);
      return {
        id: edge.id,
        waitsOn: edge.waitsOn,
        subject: edge.subject,
        gate: edge.gate,
        hold: edge.hold,
        note: edge.note,
        depth: depths.get(targetKey(edge.subject)) ?? 1,
        met: status.met,
        marked: status.marked,
        detail: status.detail,
        waitsOnLabel: orderTargetLabel(edge.waitsOn, threads),
        subjectLabel: orderTargetLabel(edge.subject, threads),
      };
    })
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        a.waitsOnLabel.localeCompare(b.waitsOnLabel) ||
        a.subjectLabel.localeCompare(b.subjectLabel),
    );
}

/** Steps this checkout is waiting on, ready for, or blocking. */
export function formatOrderPlace(rows: OrderRow[], you: OrderThreadSnapshot): string {
  const mine = (target: OrderTarget) => orderTargetMatches(target, you);
  const waitingOn = rows.filter((row) => mine(row.subject) && !row.met);
  const ready = rows.filter((row) => mine(row.subject) && row.met);
  const blocking = rows.filter((row) => mine(row.waitsOn) && !row.met);
  if (!waitingOn.length && !ready.length && !blocking.length) {
    return 'This checkout is not in the planner. set_dependency records what you wait on (omit subject). clear_dependency removes a step you are part of.';
  }
  const gate = (row: OrderRow) => (row.gate === 'in-prod' ? 'in prod' : 'in main');
  const lines = ['Where you are in the planner:'];
  for (const row of waitingOn) {
    lines.push(
      `- Waiting: ${row.waitsOnLabel} must be ${gate(row)} before you can ${row.hold}. id: ${row.id.slice(0, 8)}`,
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
    ready: rows.filter((row) => row.met),
    waiting: rows.filter((row) => !row.met),
  };
}

export function orderEdgeTouches(edge: Pick<OrderEdge, 'waitsOn' | 'subject'>, you: OrderThreadSnapshot): boolean {
  return orderTargetMatches(edge.subject, you) || orderTargetMatches(edge.waitsOn, you);
}

export function formatOrderText(rows: OrderRow[], plan?: OrderPlan | null): string {
  if (rows.length === 0) {
    return 'No orchestration plan yet. set_dependency records an order — for example PR 1 in prod before PR 2 can merge, or PR 3 in main before issue 4 can start. The Orchestration row in the sidebar shows this map.';
  }
  const lines = [
    plan
      ? `Plan “${plan.title}” is ${plan.status}. ${plan.summary}`.trim()
      : 'Orchestration. Earlier steps sit above later ones. in-main clears when that PR is merged. in-prod stays waiting until satisfy_dependency.',
    '',
  ];
  rows.forEach((row, index) => {
    const gate = row.gate === 'in-prod' ? 'in prod' : 'in main';
    const hold = row.hold === 'merge' ? 'merge' : 'start';
    const state = row.met ? 'clear' : 'waiting';
    lines.push(
      `${index + 1}. ${state}  ${row.waitsOnLabel} must be ${gate} before ${row.subjectLabel} can ${hold}`,
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

/** Side-column document. `show_waterfall` returns this so the desktop opens it. */
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
                const waiting = node.incoming.some((edge) => !edge.met);
                const clear = node.incoming.length > 0 && !waiting;
                const yours = nodeIsYou(node, you);
                const state = `${waiting ? ' waiting' : clear ? ' clear' : ''}${yours ? ' you' : ''}`;
                const drops = node.incoming
                  .map((edge) => {
                    const tone = edge.met ? 'clear' : 'waiting';
                    const note = edge.note ? `<span>${escapeHtml(edge.note)}</span>` : '';
                    return `<div class="drop"><span>After ${escapeHtml(edge.fromLabel)} is ${escapeHtml(gatePhrase(edge.gate))}, this ${escapeHtml(holdPhrase(edge.hold))}</span><span class="${tone}">${escapeHtml(edge.detail)}</span>${note}</div>`;
                  })
                  .join('');
                const kicker = `${WATERFALL_KIND[node.kind]}${yours ? ' · You' : ''}`;
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
.drop .clear { color: #6fbf73; }
.bar { border: 1px solid #333; border-radius: 10px; padding: 10px 12px; background: #1c1c1c; display: flex; flex-direction: column; gap: 2px; }
.bar.waiting { border-color: #6a5420; background: #221c10; }
.bar.clear { border-color: #2d5a32; background: #142016; }
.bar.you { outline: 1px solid #8ab4ff; }
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

export function buildWaterfall(rows: OrderRow[]): WaterfallChain[] {
  const nodes = new Map<string, WaterfallNode>();
  const links: { from: string; to: string }[] = [];
  const depthOf = new Map<string, number>();
  for (const row of rows) {
    const to = targetKey(row.subject);
    depthOf.set(to, Math.max(depthOf.get(to) ?? 0, row.depth));
    if (!depthOf.has(targetKey(row.waitsOn))) depthOf.set(targetKey(row.waitsOn), 0);
  }
  function ensure(target: OrderTarget, label: string): WaterfallNode {
    const key = targetKey(target);
    let node = nodes.get(key);
    if (!node) {
      node = {
        key,
        label,
        kind: target.kind,
        ref: target.ref,
        ...(target.repoPath ? { repoPath: target.repoPath } : {}),
        depth: depthOf.get(key) ?? 0,
        incoming: [],
      };
      nodes.set(key, node);
    }
    return node;
  }
  for (const row of rows) {
    ensure(row.waitsOn, row.waitsOnLabel);
    const subject = ensure(row.subject, row.subjectLabel);
    subject.depth = Math.max(subject.depth, row.depth);
    subject.incoming.push({
      edgeId: row.id,
      fromKey: targetKey(row.waitsOn),
      gate: row.gate,
      hold: row.hold,
      met: row.met,
      marked: row.marked,
      detail: row.detail,
      fromLabel: row.waitsOnLabel,
      note: row.note,
    });
    links.push({ from: targetKey(row.waitsOn), to: targetKey(row.subject) });
  }
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key) ?? key;
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  for (const key of nodes.keys()) parent.set(key, key);
  for (const link of links) {
    const left = find(link.from);
    const right = find(link.to);
    if (left !== right) parent.set(left, right);
  }
  const groups = new Map<string, WaterfallNode[]>();
  for (const node of nodes.values()) {
    const root = find(node.key);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }
  return [...groups.values()]
    .map((list) => ({
      nodes: list.sort(
        (a, b) => a.depth - b.depth || a.label.localeCompare(b.label),
      ),
    }))
    .sort((a, b) => (a.nodes[0]?.label ?? '').localeCompare(b.nodes[0]?.label ?? ''));
}

export interface OrderPlanBoard {
  plan: OrderPlan;
  chains: WaterfallChain[];
}

export interface OrderBoard {
  plans: OrderPlanBoard[];
}

function blankPlan(partial?: Partial<OrderPlan> | null): OrderPlan {
  return {
    id: partial?.id ?? '',
    ownerThreadId: partial?.ownerThreadId ?? '',
    title: partial?.title?.trim() || 'Planner',
    summary: partial?.summary ?? '',
    status: partial?.status === 'active' ? 'active' : 'draft',
    updatedAt: partial?.updatedAt ?? '',
  };
}

/** Accept the current board, the single-plan payload, or a bare list of chains. */
export function coerceOrderBoard(value: unknown): OrderBoard {
  if (Array.isArray(value)) {
    const chains = value as WaterfallChain[];
    return chains.length ? { plans: [{ plan: blankPlan(), chains }] } : { plans: [] };
  }
  if (!value || typeof value !== 'object') return { plans: [] };
  const row = value as { plans?: unknown; plan?: OrderPlan | null; chains?: WaterfallChain[] };
  if (Array.isArray(row.plans)) {
    const plans = row.plans.filter(
      (item): item is OrderPlanBoard =>
        Boolean(
          item &&
            typeof item === 'object' &&
            (item as OrderPlanBoard).plan &&
            Array.isArray((item as OrderPlanBoard).chains),
        ),
    );
    return { plans };
  }
  if (Array.isArray(row.chains)) {
    if (!row.plan && row.chains.length === 0) return { plans: [] };
    return { plans: [{ plan: blankPlan(row.plan), chains: row.chains }] };
  }
  return { plans: [] };
}

function incomingEdges(chains: WaterfallChain[]): WaterfallIncoming[] {
  return chains.flatMap((chain) => chain.nodes.flatMap((node) => node.incoming));
}

/** Waiting, ready, or the gate this step is holding for others. */
export function waterfallNodeState(node: WaterfallNode, chains: WaterfallChain[]): string {
  if (node.incoming.length > 0) {
    const blocked = node.incoming.filter((edge) => !edge.met);
    if (blocked.length > 0) {
      return blocked.every((edge) => edge.hold === 'merge') ? 'Waiting to merge' : 'Waiting to start';
    }
    return node.incoming.every((edge) => edge.hold === 'merge') ? 'Ready to merge' : 'Ready to start';
  }
  const outgoing = incomingEdges(chains).filter((edge) => edge.fromKey === node.key);
  if (outgoing.length === 0) return '';
  if (outgoing.every((edge) => edge.met)) {
    return outgoing.some((edge) => edge.gate === 'in-prod') ? 'In production' : 'In main';
  }
  return outgoing.some((edge) => edge.gate === 'in-prod' && !edge.met)
    ? 'Waiting on production'
    : 'Waiting on main';
}

function joinCapped(lines: string[], max = 3): string {
  if (lines.length <= max) return lines.join('. ');
  const extra = lines.length - max;
  return `${lines.slice(0, max).join('. ')}. ${extra} more`;
}

/** Idle waits, and the steps a cleared gate just unblocked. */
export function planWatchCopy(chains: WaterfallChain[]): string {
  const waiting: string[] = [];
  const ready: string[] = [];
  for (const chain of chains) {
    for (const node of chain.nodes) {
      if (node.incoming.length === 0) continue;
      const blocked = node.incoming.filter((edge) => !edge.met);
      if (blocked.length > 0) {
        const edge = blocked[0]!;
        const verb = edge.hold === 'start' ? 'start' : 'merge';
        waiting.push(`${node.label} can ${verb} once ${edge.fromLabel} is ${gatePhrase(edge.gate)}`);
      } else {
        const verb = node.incoming.every((edge) => edge.hold === 'merge') ? 'merge' : 'start';
        ready.push(`${node.label} can ${verb}`);
      }
    }
  }
  if (waiting.length === 0 && ready.length === 0) {
    return 'Later steps wait until the one above reaches its gate. In main clears when that pull request is merged. In production stays waiting until you mark it.';
  }
  if (ready.length === 0) {
    return `Running and idle. ${joinCapped(waiting)}. A merge or a production mark is what moves the next step.`;
  }
  if (waiting.length === 0) return `${joinCapped(ready)}.`;
  return `${joinCapped(ready)}. Still idle: ${joinCapped(waiting)}.`;
}

export function gatePhrase(gate: OrderGate): string {
  return gate === 'in-prod' ? 'in production' : 'in main';
}

export function holdPhrase(hold: OrderHold): string {
  return hold === 'merge' ? 'can merge' : 'can start';
}

function ownerMatches(ref: string, ownerThreadId: string): boolean {
  const left = ref.trim();
  const right = ownerThreadId.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length >= 8 && !left.includes('/') && right.startsWith(left);
}

/**
 * An orchestration step is in main when that chat's plan has steps and every
 * one of them is met. in-prod stays a manual mark. Agent plan files are not
 * consulted.
 */
export function resolveOrchestrationGates(
  plans: OrderPlan[],
  edges: OrderEdge[],
  threads: OrderThreadSnapshot[],
  marks: OrderMark[] = [],
): OrderRow[] {
  const rows = resolveOrderRows(edges, threads, marks);
  const planOf = new Map(edges.map((edge) => [edge.id, edge.planId ?? '']));
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const clearByOwner = new Map<string, boolean>();
    for (const plan of plans) {
      if (!plan.ownerThreadId) continue;
      const mine = rows.filter((row) => planOf.get(row.id) === plan.id);
      clearByOwner.set(plan.ownerThreadId, mine.length > 0 && mine.every((row) => row.met));
    }
    for (const row of rows) {
      if (row.gate !== 'in-main' || row.waitsOn.kind !== 'orchestration' || row.marked) continue;
      const plan = plans.find((item) => ownerMatches(row.waitsOn.ref, item.ownerThreadId));
      const count = plan ? rows.filter((item) => planOf.get(item.id) === plan.id).length : 0;
      const clear = plan ? clearByOwner.get(plan.ownerThreadId) === true : false;
      const detail = !plan
        ? 'no plan yet'
        : count === 0
          ? 'plan has no steps'
          : clear
            ? 'plan is clear'
            : 'plan still waiting';
      if (row.met !== clear || row.detail !== detail) {
        row.met = clear;
        row.detail = detail;
        row.marked = false;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rows;
}

export interface PlanMapNode {
  id: string;
  ownerThreadId: string;
  title: string;
  summary: string;
  status: OrderPlanStatus;
  depth: number;
  steps: number;
  waiting: number;
}

export interface PlanMapLink {
  fromId: string;
  toId: string;
  label: string;
}

/** One node per orchestration plan. Lines are spawns and waits between those plans. */
export function buildPlanMap(
  boards: { plan: OrderPlan; chains: WaterfallChain[] }[],
  threads: { id: string; parentThreadId?: string | null }[] = [],
): { nodes: PlanMapNode[]; links: PlanMapLink[] } {
  const nodes: PlanMapNode[] = boards.map((item) => {
    const subjects = item.chains.flatMap((chain) =>
      chain.nodes.filter((node) => node.incoming.length > 0),
    );
    return {
      id: item.plan.id,
      ownerThreadId: item.plan.ownerThreadId,
      title: item.plan.title,
      summary: item.plan.summary,
      status: item.plan.status,
      depth: 0,
      steps: subjects.length,
      waiting: subjects.filter((node) => node.incoming.some((edge) => !edge.met)).length,
    };
  });
  const byOwner = new Map(
    nodes.filter((node) => node.ownerThreadId).map((node) => [node.ownerThreadId, node]),
  );
  function planForRef(ref: string): PlanMapNode | undefined {
    return nodes.find((node) => ownerMatches(ref, node.ownerThreadId));
  }
  const links = new Map<string, PlanMapLink>();
  function add(fromId: string, toId: string, label: string) {
    if (!fromId || !toId || fromId === toId) return;
    const key = `${fromId}->${toId}`;
    const existing = links.get(key);
    if (!existing) links.set(key, { fromId, toId, label });
    else if (!existing.label.split(' · ').includes(label)) {
      existing.label = `${existing.label} · ${label}`;
    }
  }
  for (const item of boards) {
    for (const chain of item.chains) {
      for (const node of chain.nodes) {
        if (node.kind !== 'orchestration') continue;
        const other = planForRef(node.ref);
        if (!other || other.id === item.plan.id) continue;
        if (node.incoming.length === 0) add(other.id, item.plan.id, 'Waits on');
        else add(item.plan.id, other.id, node.incoming.every((edge) => edge.met) ? 'Ready' : 'Spawns');
      }
    }
  }
  for (const thread of threads) {
    const child = byOwner.get(thread.id);
    const parentId = thread.parentThreadId?.trim() ?? '';
    const parent = parentId ? byOwner.get(parentId) : undefined;
    if (!child || !parent) continue;
    add(parent.id, child.id, 'Spawned');
  }
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const link of links.values()) {
      const next = (depth.get(link.fromId) ?? 0) + 1;
      if (next < 12 && next > (depth.get(link.toId) ?? 0)) {
        depth.set(link.toId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const node of nodes) node.depth = depth.get(node.id) ?? 0;
  return { nodes, links: [...links.values()] };
}
