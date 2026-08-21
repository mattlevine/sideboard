import {
  coerceOrchestratorAgent,
  type OrchestratorAgentKind,
} from '../agents/orchestrator-capable.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import { resolveThreadDefaults } from '../store/app-settings.js';
import {
  getSchedule,
  listSchedules,
  recordScheduleRun,
  type ScheduledTask,
} from '../store/schedules.js';
import { findThreadByRef } from '../store/thread-store.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { AgentKind, Thread } from '../types/thread.js';

const SET_TIMEOUT_MAX = 2_147_483_647;

export interface ScheduleFireDeps {
  findThread: (id: string) => Thread | null;
  send: (id: string, prompt: string) => Promise<Thread>;
  startOrchestration: (opts: {
    goal: string;
    agent: AgentKind;
    model?: string | null;
  }) => Promise<Thread>;
}

let fireHooks: ScheduleFireDeps | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const firing = new Set<string>();

/** Test injection. */
export function setScheduleFireHooks(next: ScheduleFireDeps | null): void {
  fireHooks = next;
}

export function formatScheduledPrompt(name: string, prompt: string): string {
  return `[Scheduled: ${name}]\n${prompt}`;
}

export function clearScheduleTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  firing.clear();
}

async function defaultDeps(): Promise<ScheduleFireDeps> {
  const { getOrchestrator, startOrchestration } = await import('./orchestrator.js');
  const orch = getOrchestrator();
  return {
    findThread: (id) => findThreadByRef(id),
    send: (id, prompt) => orch.send(id, prompt),
    startOrchestration: (opts) => startOrchestration(opts),
  };
}

function pickAgent(schedule: ScheduledTask): OrchestratorAgentKind {
  if (schedule.agent) return schedule.agent;
  return coerceOrchestratorAgent(resolveThreadDefaults().agent);
}

/**
 * Fire a schedule now (Run now / due timer). `send` still defers drain to the
 * desktop host when it is alive.
 */
export async function fireSchedule(id: string): Promise<ScheduledTask> {
  const schedule = getSchedule(id);
  if (!schedule) throw new Error(`Schedule not found: ${id}`);
  if (firing.has(schedule.id)) return schedule;
  firing.add(schedule.id);
  try {
    const deps = fireHooks ?? (await defaultDeps());
    const prompt = formatScheduledPrompt(schedule.name, schedule.prompt);
    if (schedule.threadId) {
      const thread = deps.findThread(schedule.threadId);
      if (!thread || thread.status === 'archived') {
        return recordScheduleRun(schedule.id, {
          lastError: thread
            ? `Orchestration chat ${schedule.threadId} is archived`
            : `Orchestration chat not found: ${schedule.threadId}`,
        });
      }
      if (!isOrchestratorThread(thread)) {
        return recordScheduleRun(schedule.id, {
          lastError: `Thread ${schedule.threadId} is not an orchestration chat`,
        });
      }
      const sent = await deps.send(thread.id, prompt);
      return recordScheduleRun(schedule.id, {
        lastThreadId: sent.id,
        lastError: null,
      });
    }
    const created = await deps.startOrchestration({
      goal: prompt,
      agent: pickAgent(schedule),
      model: schedule.model,
    });
    return recordScheduleRun(schedule.id, {
      lastThreadId: created.id,
      lastError: null,
    });
  } catch (err) {
    return recordScheduleRun(schedule.id, {
      lastError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    firing.delete(schedule.id);
  }
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function armOne(schedule: ScheduledTask): void {
  clearTimer(schedule.id);
  if (!schedule.enabled) return;
  const at = new Date(schedule.nextRunAt);
  if (Number.isNaN(at.getTime())) return;
  const delay = Math.max(0, at.getTime() - Date.now());
  if (delay <= 250) {
    void fireSchedule(schedule.id).then(() => {
      if (isThisProcessDesktopHost()) armSchedules();
    });
    return;
  }
  const capped = Math.min(delay, SET_TIMEOUT_MAX);
  const timer = setTimeout(() => {
    timers.delete(schedule.id);
    const live = getSchedule(schedule.id);
    if (!live?.enabled) return;
    const due = new Date(live.nextRunAt).getTime();
    if (due > Date.now() + 1_000) {
      armOne(live);
      return;
    }
    void fireSchedule(live.id).then(() => {
      if (isThisProcessDesktopHost()) armSchedules();
    });
  }, capped);
  timers.set(schedule.id, timer);
}

/**
 * Arm (or catch-up) enabled schedules. Only the desktop host holds timers;
 * MCP/CLI persist the store and the desktop watcher re-arms.
 */
export function armSchedules(): void {
  if (!isThisProcessDesktopHost()) return;
  const live = new Set(listSchedules().map((row) => row.id));
  for (const id of [...timers.keys()]) {
    if (!live.has(id)) clearTimer(id);
  }
  for (const schedule of listSchedules()) {
    if (!schedule.enabled) {
      clearTimer(schedule.id);
      continue;
    }
    armOne(schedule);
  }
}
