import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeNextRunAt,
  normalizeWhen,
  type ScheduleWhen,
} from './schedule-when.js';
import {
  coerceOrchestratorAgent,
  isOrchestratorCapableAgent,
  type OrchestratorAgentKind,
} from '../agents/orchestrator-capable.js';
import type { AgentKind, Autonomy, ThreadAttachment } from '../types/thread.js';
import {
  normalizeThinkingEffort,
  type ThinkingEffort,
} from '../types/thinking-effort.js';
import { appDataDir } from './paths.js';
import { writePrivateFile } from './private-file.js';
import {
  caffeinateWhileSchedulesEnabled,
  updateAdvancedSettings,
} from './app-settings.js';

export type {
  ScheduleWhen,
  WeekdayIndex,
} from './schedule-when.js';
export {
  WEEKDAY_LABELS,
  computeNextRunAt,
  formatScheduleWhen,
  formatWeeklyDays,
  normalizeWeekdays,
  normalizeWeeklyTime,
  parseDurationMs,
  parseWeeklyDays,
  weeklyCronExpr,
} from './schedule-when.js';

export type ScheduleCreatedBy = 'mcp' | 'cli' | 'ui';

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  when: ScheduleWhen;
  /** Existing chat. Null = a new Global chat on each fire. Removed when that chat is archived. */
  threadId: string | null;
  agent: OrchestratorAgentKind | null;
  model: string | null;
  /**
   * Composer choices for the run. Null means "leave the chat / account default"
   * so older jobs do not reset a target chat.
   */
  effort: ThinkingEffort | null;
  fast: boolean | null;
  planMode: boolean | null;
  autonomy: Autonomy | null;
  /** Files, issues, and workspace links staged on the prompt. */
  attachments: ThreadAttachment[];
  /**
   * When a fresh chat is opened for this job, archive it after the run.
   * False leaves the chat in the sidebar so the person can keep talking
   * (a morning start-my-day run). Omitted on older jobs means true.
   */
  archiveChat: boolean;
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
  effort?: ThinkingEffort | null;
  fast?: boolean | null;
  planMode?: boolean | null;
  autonomy?: Autonomy | null;
  attachments?: ThreadAttachment[];
  /** Default true. False leaves a new chat open after the run. */
  archiveChat?: boolean;
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
    | 'effort'
    | 'fast'
    | 'planMode'
    | 'autonomy'
    | 'attachments'
    | 'archiveChat'
  >
>;

export function schedulesPath(): string {
  return join(appDataDir(), 'schedules.json');
}

export function defaultScheduleName(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!line) return 'Untitled automation';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/**
 * `self` → this chat: orchestration env first, then SIDEBOARD_THREAD_ID
 * (worktree). Empty / missing → null (new Global chat).
 */
export function resolveScheduleThreadId(
  raw: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = raw?.trim() || '';
  if (!value) return null;
  if (value.toLowerCase() === 'self') {
    return (
      env.SIDEBOARD_ORCHESTRATOR_THREAD_ID?.trim() ||
      env.SIDEBOARD_THREAD_ID?.trim() ||
      null
    );
  }
  return value;
}

function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

const ATTACHMENT_KINDS = new Set<ThreadAttachment['kind']>([
  'transcript',
  'file',
  'issue',
  'workspace',
  'diff-comment',
  'code-ref',
]);

function normalizeOptionalBool(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  return null;
}

function normalizeAutonomy(raw: unknown): Autonomy | null {
  return raw === 'default' || raw === 'full' ? raw : null;
}

function normalizeAttachments(raw: unknown): ThreadAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as ThreadAttachment;
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    if (typeof row.name !== 'string' || !row.name) continue;
    if (typeof row.content !== 'string') continue;
    if (!ATTACHMENT_KINDS.has(row.kind)) continue;
    const next: ThreadAttachment = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      content: row.content,
    };
    if (typeof row.path === 'string' && row.path) next.path = row.path;
    if (typeof row.previewDataUrl === 'string' && row.previewDataUrl) {
      next.previewDataUrl = row.previewDataUrl;
    }
    out.push(next);
  }
  return out;
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
    effort: normalizeThinkingEffort(raw.effort),
    fast: normalizeOptionalBool(raw.fast),
    planMode: normalizeOptionalBool(raw.planMode),
    autonomy: normalizeAutonomy(raw.autonomy),
    attachments: normalizeAttachments(raw.attachments),
    archiveChat: raw.archiveChat !== false,
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
    effort: input.effort != null ? normalizeThinkingEffort(input.effort) : null,
    fast: normalizeOptionalBool(input.fast),
    planMode: normalizeOptionalBool(input.planMode),
    autonomy: normalizeAutonomy(input.autonomy),
    attachments: normalizeAttachments(input.attachments),
    archiveChat: input.archiveChat !== false,
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

/** Enabled job whose next tick is still in the future. */
export function scheduleNeedsCaffeinate(
  task: Pick<ScheduledTask, 'enabled' | 'nextRunAt'>,
  now: Date = new Date(),
): boolean {
  if (!task.enabled) return false;
  const at = new Date(task.nextRunAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > now.getTime();
}

/** Creating/enabling a future job turns on Settings → Advanced → Caffeinate while automations are enabled. */
function ensureCaffeinateForFutureSchedule(task: ScheduledTask): void {
  if (!scheduleNeedsCaffeinate(task)) return;
  if (caffeinateWhileSchedulesEnabled()) return;
  updateAdvancedSettings({ caffeinateWhileSchedules: true });
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
  ensureCaffeinateForFutureSchedule(task);
  return task;
}

export function updateSchedule(
  id: string,
  patch: UpdateScheduledTaskPatch,
): ScheduledTask {
  const rows = readAll();
  const idx = rows.findIndex((row) => row.id === id || (id.length >= 8 && row.id.startsWith(id)));
  if (idx < 0) throw new Error(`Automation not found: ${id}`);
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
    effort:
      patch.effort !== undefined ? normalizeThinkingEffort(patch.effort) : prev.effort,
    fast: patch.fast !== undefined ? normalizeOptionalBool(patch.fast) : prev.fast,
    planMode:
      patch.planMode !== undefined
        ? normalizeOptionalBool(patch.planMode)
        : prev.planMode,
    autonomy:
      patch.autonomy !== undefined
        ? normalizeAutonomy(patch.autonomy)
        : prev.autonomy,
    attachments:
      patch.attachments !== undefined
        ? normalizeAttachments(patch.attachments)
        : prev.attachments,
    archiveChat:
      patch.archiveChat !== undefined ? patch.archiveChat !== false : prev.archiveChat,
    nextRunAt: whenChanged ? computeNextRunAt(when).toISOString() : prev.nextRunAt,
    lastError: whenChanged ? null : prev.lastError,
    updatedAt: nowIso(),
  };
  rows[idx] = next;
  writeAll(rows);
  ensureCaffeinateForFutureSchedule(next);
  return next;
}

/** Drop automations that continue this chat. Global jobs (no chat) stay. */
export function deleteSchedulesForThread(threadId: string): void {
  const id = threadId.trim();
  if (!id) return;
  const rows = readAll();
  const next = rows.filter((row) => row.threadId !== id);
  if (next.length === rows.length) return;
  writeAll(next);
}

export function deleteSchedule(id: string): void {
  const rows = readAll();
  const next = rows.filter(
    (row) => row.id !== id && !(id.length >= 8 && row.id.startsWith(id)),
  );
  if (next.length === rows.length) throw new Error(`Automation not found: ${id}`);
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
  if (idx < 0) throw new Error(`Automation not found: ${id}`);
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
