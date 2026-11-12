import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import { writePrivateFile } from '../store/private-file.js';
import { listThreads } from '../store/thread-store.js';
import {
  buildWaterfall,
  markWorkingChains,
  cycleDependencyMessage,
  dependencyIdentity,
  dependencyWouldCycle,
  executionSlice,
  normalizeOrderTarget,
  orderEdgeTouches,
  orderSnapshotFromThread,
  parseOrderGate,
  parseOrderHold,
  resolveOrchestrationGates,
  targetKey,
  type OrderEdge,
  type OrderMark,
  type OrderPlan,
  type OrderRow,
  type OrderTarget,
  type OrderThreadSnapshot,
  type OrderBoard,
  type OrderPlanBoard,
  type WaterfallChain,
} from './order-view.js';

export type {
  OrderEdge,
  OrderGate,
  OrderHold,
  OrderMark,
  OrderPlan,
  OrderRow,
  OrderTarget,
  OrderTargetKind,
  OrderThreadSnapshot,
  OrderBoard,
  OrderPlanBoard,
  WaterfallChain,
  WaterfallIncoming,
  WaterfallNode,
} from './order-view.js';
export {
  assertCallerOwnsSubject,
  buildPlanMap,
  buildWaterfall,
  defaultOrderSubject,
  executionSlice,
  formatOrderPlace,
  formatOrderText,
  formatWaterfallHtml,
  gatePhrase,
  holdPhrase,
  orderEdgeTouches,
  orderSnapshotFromThread,
  orderTargetMatches,
  parseOrderGate,
  parseOrderHold,
  parseOrderKind,
  resolveOrchestrationGates,
  resolveOrderRows,
} from './order-view.js';

export interface SetOrderDependencyInput {
  waitsOn: {
    kind: string;
    ref: string;
    repoPath?: string | null;
    label?: string | null;
  };
  gate: string;
  subject: {
    kind: string;
    ref: string;
    repoPath?: string | null;
    label?: string | null;
  };
  hold: string;
  note?: string | null;
  createdByThreadId?: string | null;
  planId?: string | null;
  ownerThreadId?: string | null;
}

interface OrderFile {
  plans: OrderPlan[];
  edges: OrderEdge[];
  marks: OrderMark[];
}

export function orderPath(): string {
  return join(appDataDir(), 'order.json');
}

function emptyFile(): OrderFile {
  return { plans: [], edges: [], marks: [] };
}

function asPlan(value: unknown, fallbackId: string): OrderPlan | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as OrderPlan;
  const title = typeof row.title === 'string' ? row.title.trim().slice(0, 120) : '';
  if (!title) return null;
  const summary = typeof row.summary === 'string' ? row.summary.trim().slice(0, 600) : '';
  const goal = typeof row.goal === 'string' ? row.goal.trim().slice(0, 400) : '';
  const status = row.status === 'active' ? 'active' : 'draft';
  const updatedAt =
    typeof row.updatedAt === 'string' && row.updatedAt ? row.updatedAt : new Date().toISOString();
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : fallbackId;
  const ownerThreadId = typeof row.ownerThreadId === 'string' ? row.ownerThreadId.trim() : '';
  return { id, ownerThreadId, title, summary, goal, status, updatedAt };
}

function asTarget(value: unknown): OrderTarget | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as OrderTarget;
  if (
    row.kind !== 'pr' &&
    row.kind !== 'issue' &&
    row.kind !== 'workspace' &&
    row.kind !== 'orchestration'
  ) {
    return null;
  }
  if (typeof row.ref !== 'string' || !row.ref.trim()) return null;
  try {
    return normalizeOrderTarget(row);
  } catch {
    return null;
  }
}

function asEdge(value: unknown): OrderEdge | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as OrderEdge;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  const waitsOn = asTarget(row.waitsOn);
  const subject = asTarget(row.subject);
  if (!waitsOn || !subject) return null;
  if (row.gate !== 'in-main' && row.gate !== 'in-prod') return null;
  if (row.hold !== 'start' && row.hold !== 'merge') return null;
  return {
    id: row.id,
    waitsOn,
    gate: row.gate,
    subject,
    hold: row.hold,
    ...(row.loop === true ? { loop: true } : {}),
    note: typeof row.note === 'string' ? row.note.slice(0, 400) : '',
    createdByThreadId: row.createdByThreadId?.trim() || null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    ...(typeof row.planId === 'string' && row.planId.trim() ? { planId: row.planId.trim() } : {}),
  };
}

function asMark(value: unknown): OrderMark | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as OrderMark;
  if (typeof row.key !== 'string' || !row.key.trim()) return null;
  if (row.gate !== 'in-main' && row.gate !== 'in-prod') return null;
  if (typeof row.at !== 'string' || !row.at) return null;
  return { key: row.key, gate: row.gate, at: row.at };
}

function readFile(): OrderFile {
  const path = orderPath();
  if (!existsSync(path)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyFile();
    const raw = parsed as { plan?: unknown; plans?: unknown; edges?: unknown; marks?: unknown };
    const edges = Array.isArray(raw.edges)
      ? raw.edges.map(asEdge).filter((row): row is OrderEdge => Boolean(row))
      : [];
    const listed = Array.isArray(raw.plans)
      ? raw.plans
          .map((row, index) => asPlan(row, `plan-${index + 1}`))
          .filter((row): row is OrderPlan => Boolean(row))
      : [];
    const legacy = listed.length ? null : asPlan(raw.plan, 'legacy');
    let plans = legacy ? [legacy] : listed;
    if (!plans.length && edges.length) {
      plans = [
        {
          id: 'legacy',
          ownerThreadId: '',
          title: 'Planner',
          summary: '',
          goal: '',
          status: 'draft',
          updatedAt: new Date().toISOString(),
        },
      ];
    }
    const fallbackId = plans[0]?.id ?? '';
    return {
      plans,
      edges: edges.map((edge) => ({ ...edge, planId: edge.planId || fallbackId })),
      marks: Array.isArray(raw.marks)
        ? raw.marks.map(asMark).filter((row): row is OrderMark => Boolean(row))
        : [],
    };
  } catch {
    return emptyFile();
  }
}

function pruneMarks(edges: OrderEdge[], marks: OrderMark[]): OrderMark[] {
  const live = new Set(edges.map((edge) => `${targetKey(edge.waitsOn)}|${edge.gate}`));
  return marks.filter((mark) => live.has(`${mark.key}|${mark.gate}`));
}

function writeFile(file: OrderFile): void {
  const next = {
    plans: file.plans,
    edges: file.edges,
    marks: pruneMarks(file.edges, file.marks),
  };
  writePrivateFile(orderPath(), `${JSON.stringify(next, null, 2)}\n`);
}

function planByOwner(file: OrderFile, ownerThreadId: string | undefined): OrderPlan | null {
  const owner = ownerThreadId?.trim() ?? '';
  if (owner) return file.plans.find((plan) => plan.ownerThreadId === owner) ?? null;
  return file.plans.length === 1 ? file.plans[0]! : null;
}

export function getOrderPlan(ownerThreadId?: string): OrderPlan | null {
  return planByOwner(readFile(), ownerThreadId);
}

export function listOrderPlans(): OrderPlan[] {
  return readFile().plans;
}

export function setOrderPlan(input: {
  title: string;
  summary?: string | null;
  goal?: string | null;
  ownerThreadId?: string | null;
}): OrderPlan {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new Error('Plan title is required');
  const file = readFile();
  const owner = input.ownerThreadId?.trim() ?? '';
  const existing = file.plans.find((plan) => plan.ownerThreadId === owner);
  const plan: OrderPlan = {
    id: existing?.id ?? randomUUID(),
    ownerThreadId: owner,
    title,
    summary: input.summary?.trim().slice(0, 600) ?? existing?.summary ?? '',
    goal:
      input.goal === undefined
        ? (existing?.goal ?? '')
        : (input.goal?.trim().slice(0, 400) ?? ''),
    status: existing?.status === 'active' ? 'active' : 'draft',
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    const index = file.plans.findIndex((row) => row.id === existing.id);
    file.plans[index] = plan;
  } else {
    file.plans.push(plan);
  }
  writeFile(file);
  return plan;
}

export function executeOrderPlan(ownerThreadId?: string): {
  plan: OrderPlan;
  ready: OrderRow[];
  waiting: OrderRow[];
} {
  const file = readFile();
  const current = planByOwner(file, ownerThreadId);
  if (!current) throw new Error('set_plan first. This chat has no plan yet.');
  const edges = file.edges.filter((edge) => edge.planId === current.id);
  if (edges.length === 0) {
    throw new Error('The planner is empty. set_plan and set_dependency first.');
  }
  const plan: OrderPlan = { ...current, status: 'active', updatedAt: new Date().toISOString() };
  const index = file.plans.findIndex((row) => row.id === current.id);
  file.plans[index] = plan;
  writeFile(file);
  const ids = new Set(edges.map((edge) => edge.id));
  const rows = resolveOrchestrationGates(file.plans, file.edges, threadSnapshots(), file.marks);
  const slice = executionSlice(rows.filter((row) => ids.has(row.id)));
  return { plan, ready: slice.ready, waiting: slice.waiting };
}

export function listOrderEdges(): OrderEdge[] {
  return readFile().edges;
}

export function listOrderMarks(): OrderMark[] {
  return readFile().marks;
}

function threadSnapshots() {
  try {
    return listThreads({ includeArchived: true }).map(orderSnapshotFromThread);
  } catch {
    return [];
  }
}

export function listOrderRows(planId?: string): OrderRow[] {
  const file = readFile();
  const rows = resolveOrchestrationGates(file.plans, file.edges, threadSnapshots(), file.marks);
  if (!planId) return rows;
  const ids = new Set(file.edges.filter((edge) => edge.planId === planId).map((edge) => edge.id));
  return rows.filter((row) => ids.has(row.id));
}

export function listWaterfall(planId?: string): WaterfallChain[] {
  return markWorkingChains(buildWaterfall(listOrderRows(planId)), threadSnapshots());
}

export function listOrderBoard(): OrderBoard {
  const file = readFile();
  const threads = threadSnapshots();
  const rows = resolveOrchestrationGates(file.plans, file.edges, threads, file.marks);
  const plans: OrderPlanBoard[] = file.plans.map((plan) => ({
    plan,
    chains: markWorkingChains(
      buildWaterfall(rows.filter((row) => {
        const edge = file.edges.find((item) => item.id === row.id);
        return edge?.planId === plan.id;
      })),
      threads,
    ),
  }));
  plans.sort((a, b) => a.plan.title.localeCompare(b.plan.title));
  return { plans };
}

function selectPlan(
  file: OrderFile,
  input: { planId?: string | null; ownerThreadId?: string | null },
): OrderPlan {
  const planId = input.planId?.trim();
  if (planId) {
    const hit = file.plans.find((plan) => plan.id === planId);
    if (!hit) throw new Error('No plan with that id.');
    return hit;
  }
  const owner = input.ownerThreadId?.trim();
  if (owner) {
    const hit = file.plans.find((plan) => plan.ownerThreadId === owner);
    if (!hit) throw new Error('set_plan first. This chat has no plan yet.');
    return hit;
  }
  if (file.plans.length === 1) return file.plans[0]!;
  if (file.plans.length === 0) {
    const plan: OrderPlan = {
      id: randomUUID(),
      ownerThreadId: '',
      title: 'Planner',
      summary: '',
      goal: '',
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };
    file.plans.push(plan);
    return plan;
  }
  throw new Error('More than one plan is open. Pass the orchestration chat.');
}

function findEdge(id: string, edges: OrderEdge[]): OrderEdge | null {
  const key = id.trim();
  if (!key) return null;
  return (
    edges.find((edge) => edge.id === key || (key.length >= 8 && edge.id.startsWith(key))) ??
    null
  );
}

export function setOrderDependency(
  input: SetOrderDependencyInput,
): { edge: OrderEdge; created: boolean } {
  const waitsOn = normalizeOrderTarget(input.waitsOn);
  const subject = normalizeOrderTarget(input.subject);
  const gate = parseOrderGate(input.gate);
  const hold = parseOrderHold(input.hold);
  const file = readFile();
  const plan = selectPlan(file, input);
  const scoped = file.edges.filter((edge) => edge.planId === plan.id);
  const draft = { waitsOn, subject, gate, hold };
  const existing = scoped.find((edge) => dependencyIdentity(edge) === dependencyIdentity(draft));
  if (existing) return { edge: existing, created: false };
  if (targetKey(subject) === targetKey(waitsOn)) {
    throw new Error(cycleDependencyMessage(draft));
  }
  const loop = dependencyWouldCycle(scoped, draft);
  const edge: OrderEdge = {
    id: randomUUID(),
    planId: plan.id,
    waitsOn,
    gate,
    subject,
    hold,
    ...(loop ? { loop: true } : {}),
    note: input.note?.trim().slice(0, 400) ?? '',
    createdByThreadId: input.createdByThreadId?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  file.edges.push(edge);
  writeFile(file);
  return { edge, created: true };
}

export function clearOrderDependency(
  id: string,
  caller?: OrderThreadSnapshot | null,
  ownerThreadId?: string,
): void {
  const file = readFile();
  const edge = findEdge(id, file.edges);
  if (!edge) throw new Error(`No planner step ${id}`);
  if (caller && !orderEdgeTouches(edge, caller)) {
    throw new Error('This checkout can only change a step it is part of.');
  }
  const owner = ownerThreadId?.trim();
  if (owner) {
    const plan = file.plans.find((row) => row.ownerThreadId === owner);
    if (!plan || edge.planId !== plan.id) {
      throw new Error('This plan belongs to another orchestration chat.');
    }
  }
  file.edges = file.edges.filter((row) => row.id !== edge.id);
  writeFile(file);
}

export function satisfyOrderDependency(id: string, satisfied = true): OrderEdge {
  const file = readFile();
  const edge = findEdge(id, file.edges);
  if (!edge) throw new Error(`No planner step ${id}`);
  const key = targetKey(edge.waitsOn);
  file.marks = file.marks.filter((mark) => !(mark.key === key && mark.gate === edge.gate));
  if (satisfied) file.marks.push({ key, gate: edge.gate, at: new Date().toISOString() });
  writeFile(file);
  return edge;
}

