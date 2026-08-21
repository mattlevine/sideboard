import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import {
  coerceOrchestratorAgent,
  isOrchestratorCapableAgent,
  type OrchestratorAgentKind,
} from '../agents/orchestrator-capable.js';
import type { AgentKind } from '../types/thread.js';
import { appDataDir } from './paths.js';
import { writePrivateFile } from './private-file.js';

export type ScheduleCreatedBy = 'mcp' | 'cli' | 'ui';

export type ScheduleWhen =
  | { kind: 'once'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; expr: string; tz?: string };

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  when: ScheduleWhen;
  /** Existing orchestration chat. Null = create a new Global chat on fire. */
  threadId: string | null;
  agent: OrchestratorAgentKind | null;
  model: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  lastThreadId: string | null;
  lastError: string | null;
  createdBy: ScheduleCreatedBy;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTaskInput {
  name?: string;
  prompt: string;
  when: ScheduleWhen;
  threadId?: string | null;
  agent?: AgentKind | null;
  model?: string | null;
  enabled?: boolean;
  createdBy: ScheduleCreatedBy;
}

export type UpdateScheduledTaskPatch = Partial<
  Pick<
    ScheduledTask,
    | 'name'
    | 'prompt'
    | 'enabled'
    | 'when'
    | 'threadId'
    | 'agent'
    | 'model'
  >
>;

const DURATION_RE = /^(\d+)(s|m|h|d)$/i;
const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function schedulesPath(): string {
  return join(appDataDir(), 'schedules.json');
}

export function parseDurationMs(every: string): number | null {
  const m = every.trim().match(DURATION_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  return n * UNIT_MS[unit];
}

export function defaultScheduleName(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!line) return 'Untitled schedule';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** `self` → SIDEBOARD_ORCHESTRATOR_THREAD_ID. Empty / missing → null (new chat). */
export function resolveScheduleThreadId(
  raw: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = raw?.trim() || '';
  if (!value) return null;
  if (value.toLowerCase() === 'self') {
    return env.SIDEBOARD_ORCHESTRATOR_THREAD_ID?.trim() || null;
  }
  return value;
}

export function computeNextRunAt(when: ScheduleWhen, from: Date = new Date()): Date {
  if (when.kind === 'once') {
    const at = new Date(when.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`Invalid once-at datetime: ${when.at}`);
    }
    return at;
  }
  if (when.kind === 'every') {
    const ms = parseDurationMs(when.every);
    if (!ms) {
      throw new Error(`Invalid interval: ${when.every} (use 15m, 1h, 6h, 1d)`);
    }
    return new Date(from.getTime() + ms);
  }
  try {
    const job = new Cron(when.expr, {
      timezone: when.tz?.trim() || undefined,
      paused: true,
    });
    const next = job.nextRun(from);
    if (!next) {
      throw new Error(`Cron expression has no next run: ${when.expr}`);
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid cron: ${message}`);
  }
}

export function formatScheduleWhen(when: ScheduleWhen): string {
  if (when.kind === 'once') return `once at ${when.at}`;
  if (when.kind === 'every') return `every ${when.every}`;
  const tz = when.tz?.trim();
  return tz ? `cron ${when.expr} (${tz})` : `cron ${when.expr}`;
}

function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

function normalizeWhen(raw: unknown): ScheduleWhen {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Schedule is missing `when`');
  }
  const rec = raw as Record<string, unknown>;
  const kind = rec.kind;
  if (kind === 'once' && typeof rec.at === 'string') {
    return { kind: 'once', at: rec.at };
  }
  if (kind === 'every' && typeof rec.every === 'string') {
    return { kind: 'every', every: rec.every };
  }
  if (kind === 'cron' && typeof rec.expr === 'string') {
    return {
      kind: 'cron',
      expr: rec.expr,
      tz: typeof rec.tz === 'string' && rec.tz.trim() ? rec.tz.trim() : undefined,
    };
  }
  throw new Error('Schedule `when` must be once, every, or cron');
}

function normalizeTask(raw: ScheduledTask): ScheduledTask {
  const when = normalizeWhen(raw.when);
  const agent =
    raw.agent && isOrchestratorCapableAgent(raw.agent)
      ? raw.agent
      : null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : defaultScheduleName(raw.prompt),
    prompt: String(raw.prompt ?? ''),
    enabled: Boolean(raw.enabled),
    when,
    threadId: raw.threadId?.trim() || null,
    agent,
    model: raw.model?.trim() || null,
    nextRunAt: raw.nextRunAt,
    lastRunAt: raw.lastRunAt ?? null,
    lastThreadId: raw.lastThreadId ?? null,
    lastError: raw.lastError ?? null,
    createdBy:
      raw.createdBy === 'mcp' || raw.createdBy === 'cli' || raw.createdBy === 'ui'
        ? raw.createdBy
        : 'ui',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function readAll(): ScheduledTask[] {
  const path = schedulesPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        try {
          return normalizeTask(row as ScheduledTask);
        } catch {
          return null;
        }
      })
      .filter((row): row is ScheduledTask => Boolean(row?.id && row.prompt));
  } catch {
    return [];
  }
}

function writeAll(rows: ScheduledTask[]): void {
  writePrivateFile(schedulesPath(), `${JSON.stringify(rows, null, 2)}\n`);
}

function buildTask(input: CreateScheduledTaskInput, now: Date): ScheduledTask {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Schedule prompt is required');
  const when = normalizeWhen(input.when);
  const nextRunAt = computeNextRunAt(when, now).toISOString();
  const ts = nowIso(now);
  const agent = input.agent
    ? coerceOrchestratorAgent(input.agent)
    : null;
  return {
    id: randomUUID(),
    name: (input.name?.trim() || defaultScheduleName(prompt)),
    prompt,
    enabled: input.enabled !== false,
    when,
    threadId: input.threadId?.trim() || null,
    agent,
    model: input.model?.trim() || null,
    nextRunAt,
    lastRunAt: null,
    lastThreadId: null,
    lastError: null,
    createdBy: input.createdBy,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function listSchedules(): ScheduledTask[] {
  return readAll().sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

/** True when at least one schedule is enabled (desktop caffeinate source). */
export function hasEnabledSchedules(): boolean {
  return listSchedules().some((row) => row.enabled);
}

export function getSchedule(id: string): ScheduledTask | null {
  const key = id.trim();
  if (!key) return null;
  return (
    readAll().find(
      (row) => row.id === key || row.id.startsWith(key) && key.length >= 8,
    ) ?? null
  );
}

export function createSchedule(input: CreateScheduledTaskInput): ScheduledTask {
  const task = buildTask(input, new Date());
  const rows = readAll();
  rows.push(task);
  writeAll(rows);
  return task;
}

export function updateSchedule(
  id: string,
  patch: UpdateScheduledTaskPatch,
): ScheduledTask {
  const rows = readAll();
  const idx = rows.findIndex((row) => row.id === id || (id.length >= 8 && row.id.startsWith(id)));
  if (idx < 0) throw new Error(`Schedule not found: ${id}`);
  const prev = rows[idx];
  const when = patch.when ? normalizeWhen(patch.when) : prev.when;
  const prompt = patch.prompt !== undefined ? patch.prompt.trim() : prev.prompt;
  if (!prompt) throw new Error('Schedule prompt is required');
  const whenChanged = patch.when !== undefined;
  const next: ScheduledTask = {
    ...prev,
    name:
      patch.name !== undefined
        ? patch.name.trim() || defaultScheduleName(prompt)
        : prev.name,
    prompt,
    enabled: patch.enabled ?? prev.enabled,
    when,
    threadId:
      patch.threadId !== undefined ? patch.threadId?.trim() || null : prev.threadId,
    agent:
      patch.agent !== undefined
        ? patch.agent
          ? coerceOrchestratorAgent(patch.agent)
          : null
        : prev.agent,
    model:
      patch.model !== undefined ? patch.model?.trim() || null : prev.model,
    nextRunAt: whenChanged ? computeNextRunAt(when).toISOString() : prev.nextRunAt,
    lastError: whenChanged ? null : prev.lastError,
    updatedAt: nowIso(),
  };
  rows[idx] = next;
  writeAll(rows);
  return next;
}

export function deleteSchedule(id: string): void {
  const rows = readAll();
  const next = rows.filter(
    (row) => row.id !== id && !(id.length >= 8 && row.id.startsWith(id)),
  );
  if (next.length === rows.length) throw new Error(`Schedule not found: ${id}`);
  writeAll(next);
}

export function recordScheduleRun(
  id: string,
  result: {
    lastThreadId?: string | null;
    lastError?: string | null;
    firedAt?: Date;
  },
): ScheduledTask {
  const rows = readAll();
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error(`Schedule not found: ${id}`);
  const prev = rows[idx];
  const firedAt = result.firedAt ?? new Date();
  const next: ScheduledTask = {
    ...prev,
    enabled: prev.when.kind === 'once' ? false : prev.enabled,
    nextRunAt:
      prev.when.kind === 'once'
        ? prev.nextRunAt
        : computeNextRunAt(prev.when, firedAt).toISOString(),
    lastRunAt: nowIso(firedAt),
    lastThreadId:
      result.lastThreadId !== undefined ? result.lastThreadId : prev.lastThreadId,
    lastError: result.lastError ?? null,
    updatedAt: nowIso(firedAt),
  };
  rows[idx] = next;
  writeAll(rows);
  return next;
}
