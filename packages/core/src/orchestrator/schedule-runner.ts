import {
  coerceOrchestratorAgent,
  type OrchestratorAgentKind,
} from '../agents/orchestrator-capable.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import { resolveOrchestratorDefaults } from '../store/app-settings.js';
import {
  getSchedule,
  listSchedules,
  recordScheduleRun,
  updateSchedule,
  type ScheduledTask,
} from '../store/schedules.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import { findThreadByRef } from '../store/thread-store.js';
import type { AgentKind, Thread, ThreadOptionsPatch } from '../types/thread.js';

const SET_TIMEOUT_MAX = 2_147_483_647;

export interface ScheduleSendOpts {
  attachments?: Thread['attachments'];
  /** Applied to an existing chat before the prompt is queued. */
  options?: ThreadOptionsPatch;
}

export interface ScheduleFireDeps {
  findThread: (id: string) => Thread | null;
  send: (id: string, prompt: string, opts?: ScheduleSendOpts) => Promise<Thread>;
  startOrchestration: (opts: {
    goal: string;
    agent: AgentKind;
    model?: string | null;
    autonomy?: Thread['autonomy'];
    effort?: Thread['effort'];
    fast?: boolean;
    planMode?: boolean;
    attachments?: Thread['attachments'];
    /** Archive this new chat when the run finishes. Omit to keep the chat. */
    ephemeralAutomationId?: string;
    ephemeralTitle?: string;
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
    send: async (id, prompt, opts) => {
      if (opts?.options && Object.keys(opts.options).length > 0) {
        try {
          orch.setThreadOptions(id, opts.options);
        } catch {
          // Mid-chat provider switches are refused. Model belongs to that agent.
          const rest = scheduleOptionsAfterRefusedAgentSwitch(opts.options);
          if (Object.keys(rest).length > 0) {
            try {
              orch.setThreadOptions(id, rest);
            } catch {
              // The prompt still sends with the chat's current options.
            }
          }
        }
      }
      const thread = findThreadByRef(id);
      const attachments = thread
        ? persistPendingFileAttachments(thread.worktreePath, opts?.attachments ?? [])
        : (opts?.attachments ?? []);
      return orch.send(id, prompt, { attachments });
    },
    startOrchestration: (opts) => startOrchestration(opts),
  };
}

/**
 * Drop agent and model after a mid-chat provider switch is refused.
 * Model ids are agent-specific; Auto (`null`) would still reset the chat.
 */
export function scheduleOptionsAfterRefusedAgentSwitch(
  options: ThreadOptionsPatch,
): ThreadOptionsPatch {
  const { agent: _agent, model: _model, ...rest } = options;
  return rest;
}

/** Composer choices to apply on an existing chat. Omitted fields stay as they are. */
export function scheduleSendOptions(schedule: ScheduledTask): ThreadOptionsPatch | undefined {
  const patch: ThreadOptionsPatch = {};
  if (schedule.agent) {
    patch.agent = schedule.agent;
    // Null model is Auto, and only when the composer saved an agent.
    patch.model = schedule.model;
  } else if (schedule.model) {
    patch.model = schedule.model;
  }
  if (schedule.effort) patch.effort = schedule.effort;
  if (schedule.fast != null) patch.fast = schedule.fast;
  if (schedule.planMode != null) patch.planMode = schedule.planMode;
  if (schedule.autonomy) patch.autonomy = schedule.autonomy;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function pickAgent(schedule: ScheduledTask): OrchestratorAgentKind {
  if (schedule.agent) return schedule.agent;
  return coerceOrchestratorAgent(resolveOrchestratorDefaults().agent);
}

/**
 * Fire a schedule now (Run now / due timer). `send` still defers drain to the
 * desktop host when it is alive.
 */
export async function fireSchedule(id: string): Promise<ScheduledTask> {
  const schedule = getSchedule(id);
  if (!schedule) throw new Error(`Automation not found: ${id}`);
  if (firing.has(schedule.id)) return schedule;
  firing.add(schedule.id);
  try {
    const deps = fireHooks ?? (await defaultDeps());
    const prompt = formatScheduledPrompt(schedule.name, schedule.prompt);
    const target = schedule.threadId ? deps.findThread(schedule.threadId) : null;
    if (target && target.status !== 'archived') {
      const sent = await deps.send(target.id, prompt, {
        attachments: schedule.attachments,
        options: scheduleSendOptions(schedule),
      });
      return recordScheduleRun(schedule.id, {
        lastThreadId: sent.id,
        lastError: null,
      });
    }
    // A named recurring chat that disappeared should keep using the replacement.
    // Other fresh chats archive when the run finishes unless archiveChat is off,
    // so a morning run can stay in the sidebar.
    const pinReplacement = Boolean(schedule.threadId) && schedule.when.kind !== 'once';
    const archiveFresh = schedule.archiveChat !== false && !pinReplacement;
    const created = await deps.startOrchestration({
      goal: prompt,
      agent: pickAgent(schedule),
      model: schedule.model,
      ...(schedule.effort ? { effort: schedule.effort } : {}),
      ...(schedule.fast != null ? { fast: schedule.fast } : {}),
      ...(schedule.planMode != null ? { planMode: schedule.planMode } : {}),
      ...(schedule.autonomy ? { autonomy: schedule.autonomy } : {}),
      attachments: schedule.attachments,
      ...(archiveFresh
        ? { ephemeralAutomationId: schedule.id, ephemeralTitle: schedule.name }
        : {}),
    });
    if (pinReplacement) {
      updateSchedule(schedule.id, { threadId: created.id });
    }
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
