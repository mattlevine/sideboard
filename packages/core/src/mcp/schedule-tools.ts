import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  parseWeeklyDays,
  resolveScheduleThreadId,
  scheduleNeedsCaffeinate,
  updateSchedule,
  type ScheduledTask,
  type ScheduleWhen,
} from '../store/schedules.js';
import { fireSchedule } from '../orchestrator/schedule-runner.js';
import { mcpJson } from './issue-list.js';

function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

function fail(err: unknown) {
  return text(
    { error: err instanceof Error ? err.message : String(err) },
    true,
  );
}

type CadenceArgs = {
  at?: string;
  every?: string;
  cron?: string;
  tz?: string;
  time?: string;
  days?: string;
};

function parseWhen(args: CadenceArgs): ScheduleWhen {
  const at = args.at?.trim();
  const every = args.every?.trim();
  const cron = args.cron?.trim();
  const time = args.time?.trim();
  const days = args.days?.trim();
  if (days && !time && !at && !every && !cron) {
    throw new Error('days needs time (HH:mm), for example time=07:30 days=weekdays');
  }
  const picked = [at, every, cron, time].filter(Boolean);
  if (picked.length !== 1) {
    throw new Error(
      'Pass exactly one of at (ISO datetime), every (15m/1h/6h/1d), time (HH:mm), or cron',
    );
  }
  if (at) return { kind: 'once', at };
  if (every) return { kind: 'every', every };
  if (time) {
    return {
      kind: 'weekly',
      time,
      days: parseWeeklyDays(days || 'daily'),
      tz: args.tz?.trim() || undefined,
    };
  }
  return {
    kind: 'cron',
    expr: cron!,
    tz: args.tz?.trim() || undefined,
  };
}

/**
 * Partial `time` / `days` edits apply only to an existing weekly job.
 * Both together switch any cadence to weekly. One of them on an interval,
 * cron, or one-shot job would drop that cadence.
 */
export function whenFromUpdate(id: string, args: CadenceArgs): ScheduleWhen | undefined {
  const at = args.at?.trim();
  const every = args.every?.trim();
  const cron = args.cron?.trim();
  const time = args.time?.trim();
  const days = args.days?.trim();
  const tzSet = args.tz !== undefined;
  if (!at && !every && !cron && !time && !days && !tzSet) return undefined;
  if ((time || days) && !at && !every && !cron) {
    const current = getSchedule(id);
    const weekly = current?.when.kind === 'weekly' ? current.when : null;
    if (!weekly && !(time && days)) {
      const kind = current?.when.kind ?? 'missing';
      throw new Error(
        `time and days change a days-at-a-time automation. This job is ${kind}. Pass time and days together to switch it, or at / every / cron to replace the cadence.`,
      );
    }
    const clock = time || weekly?.time;
    if (!clock) {
      throw new Error('time (HH:mm) is required, for example time=07:30 days=weekdays');
    }
    const prevTz =
      current?.when.kind === 'weekly' || current?.when.kind === 'cron' ? current.when.tz : undefined;
    return {
      kind: 'weekly',
      time: clock,
      days: days ? parseWeeklyDays(days) : (weekly?.days ?? parseWeeklyDays('daily')),
      tz: tzSet ? args.tz?.trim() || undefined : prevTz,
    };
  }
  if (!at && !every && !cron && !time && !days && tzSet) {
    const current = getSchedule(id);
    if (current?.when.kind === 'weekly' || current?.when.kind === 'cron') {
      return { ...current.when, tz: args.tz?.trim() || undefined };
    }
    return undefined;
  }
  return parseWhen(args);
}

function createdHint(schedule: ScheduledTask): string {
  const awake = scheduleNeedsCaffeinate(schedule)
    ? ' Caffeinate while automations are enabled is now on so the Mac can stay awake until this job is due.'
    : '';
  const fresh = schedule.threadId
    ? ' This job is removed when that chat is archived.'
    : schedule.archiveChat === false
      ? ' This job leaves the new chat open so you can keep talking.'
      : ' A new Global chat is archived when the run finishes (History keeps the last 5 runs). Pass archiveChat=false to leave it open.';
  return `Fires while Sideboard.app is running.${fresh}${awake}`;
}

/**
 * Local schedule tools (worktree + orchestration). Jobs persist in
 * schedules.json and fire from the desktop host via send / startOrchestration.
 */
export function registerScheduleTools(server: McpServer): void {
  server.tool(
    'list_schedules',
    'List local Sideboard automations that trigger a chat when due. Jobs fire only while Sideboard.app is running on this Mac (sleep skips until wake). Shown in the sidebar after Board.',
    {},
    async () => {
      try {
        return text({ schedules: listSchedules() });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'create_schedule',
    'Create a local automation that, when due, sends a prompt to an existing chat (chatId) or starts a new Global orchestration chat (omit chatId). Pass chatId=self to continue this chat. A job bound to a chat is removed when that chat is archived or gone; it does not start a new Global chat. Omit chatId only for a Global automation that should outlive this chat. Exactly one of at (ISO datetime), every (15m/1h/6h/1d), time (HH:mm, with days such as weekdays or mon,wed), or cron (5-field). Recurring jobs without chatId open a new Global chat each run and archive it when that run finishes unless archiveChat is false (leave the chat open to keep talking, for example a morning start-my-day run). History keeps the last 5 archived runs for that automation. Creating or enabling a future job turns on Settings → Advanced → Caffeinate while automations are enabled so the Mac stays awake until due. Sideboard.app must be running for the job to fire.',
    {
      prompt: z.string().describe('User message / goal queued when the automation fires'),
      name: z.string().optional(),
      at: z.string().optional().describe('ISO datetime for a one-shot'),
      every: z.string().optional().describe('Interval such as 15m, 1h, 6h, 1d'),
      time: z
        .string()
        .optional()
        .describe('HH:mm (24-hour) clock time. Omit days for every day.'),
      days: z
        .string()
        .optional()
        .describe('daily, weekdays, weekends, or days such as mon,wed,fri or mon-fri. Use with time.'),
      cron: z.string().optional().describe('5-field cron expression'),
      tz: z
        .string()
        .optional()
        .describe('IANA timezone for cron or time (default: system)'),
      archiveChat: z
        .boolean()
        .optional()
        .describe(
          'Archive a new Global chat when the run finishes. Default true. Pass false to leave the chat open.',
        ),
      chatId: z
        .string()
        .optional()
        .describe(
          'Existing chat id, or "self" for this chat. That job is removed when the chat is archived. Omit only for a Global automation that should outlive this chat.',
        ),
      threadId: z
        .string()
        .optional()
        .describe('Legacy alias for chatId.'),
      agent: z
        .enum(['claude', 'cursor', 'codex', 'opencode'])
        .optional()
        .describe('Agent for a new Global chat (omit for Account default)'),
      model: z.string().optional(),
    },
    async (args) => {
      try {
        const when = parseWhen(args);
        const rawChatId = args.chatId ?? args.threadId;
        const threadId = resolveScheduleThreadId(rawChatId);
        if (rawChatId?.trim().toLowerCase() === 'self' && !threadId) {
          return fail(
            new Error(
              'chatId=self needs this chat id (SIDEBOARD_THREAD_ID or SIDEBOARD_ORCHESTRATOR_THREAD_ID)',
            ),
          );
        }
        const schedule = createSchedule({
          name: args.name,
          prompt: args.prompt,
          when,
          threadId,
          agent: args.agent,
          model: args.model,
          archiveChat: args.archiveChat,
          createdBy: 'mcp',
        });
        return text({
          schedule,
          hint: createdHint(schedule),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'update_schedule',
    'Update a local automation (prompt, cadence, target chat, archiveChat, enabled). Pass id from list_schedules.',
    {
      id: z.string(),
      prompt: z.string().optional(),
      name: z.string().optional(),
      at: z.string().optional(),
      every: z.string().optional(),
      time: z.string().optional().describe('HH:mm clock time. Use with days, or alone to change the time of a weekly job.'),
      days: z
        .string()
        .optional()
        .describe('daily, weekdays, weekends, or mon,wed,fri. Use with time, or alone on an existing weekly job.'),
      cron: z.string().optional(),
      tz: z.string().optional(),
      archiveChat: z
        .boolean()
        .optional()
        .describe('Archive a new Global chat when the run finishes. False leaves it open.'),
      chatId: z
        .string()
        .optional()
        .describe(
          'Existing chat, "self", or empty string for a Global chat each run. A bound job is removed when that chat is archived.',
        ),
      threadId: z
        .string()
        .optional()
        .describe('Legacy alias for chatId.'),
      agent: z.enum(['claude', 'cursor', 'codex', 'opencode']).optional(),
      model: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => {
      try {
        const when = whenFromUpdate(args.id, args);
        let threadId: string | null | undefined;
        const rawChatId = args.chatId ?? args.threadId;
        if (rawChatId !== undefined) {
          threadId = resolveScheduleThreadId(rawChatId);
          if (rawChatId.trim().toLowerCase() === 'self' && !threadId) {
            return fail(
              new Error(
                'chatId=self needs this chat id (SIDEBOARD_THREAD_ID or SIDEBOARD_ORCHESTRATOR_THREAD_ID)',
              ),
            );
          }
        }
        const schedule = updateSchedule(args.id, {
          prompt: args.prompt,
          name: args.name,
          when,
          threadId,
          agent: args.agent,
          enabled: args.enabled,
          model: args.model,
          archiveChat: args.archiveChat,
        });
        return text({ schedule });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'delete_schedule',
    'Delete a local automation. Pass id from list_schedules.',
    { id: z.string() },
    async ({ id }) => {
      try {
        deleteSchedule(id);
        return text({ ok: true, id });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'run_schedule',
    'Fire an automation now (does not wait for nextRunAt). Queues the prompt on the target chat or starts a new Global chat. If Sideboard.app is running, the desktop drains the turn.',
    { id: z.string() },
    async ({ id }) => {
      try {
        if (!getSchedule(id)) {
          return fail(new Error(`Automation not found: ${id}`));
        }
        const schedule = await fireSchedule(id);
        return text({ schedule });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
