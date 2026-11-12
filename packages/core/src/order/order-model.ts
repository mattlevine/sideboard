/**
 * Fleet order of operations. A step waits until an earlier PR, issue, or
 * workspace reaches a gate (in main, or in production) before it can start
 * or merge. The sidebar Orchestration item opens that chat.
 * Pure: no filesystem. The store in `order.ts` persists the edges.
 */

export type OrderPlanStatus = 'draft' | 'active';

export interface OrderPlan {
  id: string;
  /** Orchestration chat this plan belongs to. */
  ownerThreadId: string;
  title: string;
  summary: string;
  /** Outcome the steps are trying to reach. */
  goal: string;
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
  /** True when this step returns to an earlier one. It does not block the first pass. */
  loop?: boolean;
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
  /** Return to an earlier step. It does not block the first pass. */
  loop?: boolean;
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
  /** Return to an earlier step. It does not block the first pass. */
  loop?: boolean;
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
  /** A chat for this step is running or queued. */
  working?: boolean;
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
        loop: edge.loop === true,
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
