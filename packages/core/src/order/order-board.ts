import type {
  OrderPlanStatus,
  OrderPlan,
  OrderGate,
  OrderHold,
  OrderTarget,
  OrderEdge,
  OrderMark,
  OrderThreadSnapshot,
  OrderRow,
  WaterfallIncoming,
  WaterfallNode,
  WaterfallChain,
} from './order-model.js';
import {
  targetKey,
  resolveOrderRows,
} from './order-model.js';

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
      loop: row.loop === true,
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
    goal: partial?.goal ?? '',
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
    const blocked = node.incoming.filter((edge) => !edge.met && !edge.loop);
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
      const gating = node.incoming.filter((edge) => !edge.loop);
      if (gating.length === 0) continue;
      const blocked = gating.filter((edge) => !edge.met);
      if (blocked.length > 0) {
        const edge = blocked[0]!;
        const verb = edge.hold === 'start' ? 'start' : 'merge';
        waiting.push(`${node.label} can ${verb} once ${edge.fromLabel} is ${gatePhrase(edge.gate)}`);
      } else {
        const verb = gating.every((edge) => edge.hold === 'merge') ? 'merge' : 'start';
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
      waiting: subjects.filter((node) => node.incoming.some((edge) => !edge.met && !edge.loop)).length,
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
        else add(item.plan.id, other.id, node.incoming.every((edge) => edge.met || edge.loop) ? 'Ready' : 'Spawns');
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
