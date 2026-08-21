import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  resolveScheduleThreadId,
  updateSchedule,
  type ScheduleWhen,
} from '../store/schedules.js';
import { fireSchedule } from '../orchestrator/schedule-runner.js';

function text(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function fail(err: unknown) {
  return text(
    { error: err instanceof Error ? err.message : String(err) },
    true,
  );
}

function parseWhen(args: {
  at?: string;
  every?: string;
  cron?: string;
  tz?: string;
}): ScheduleWhen {
  const count = [args.at, args.every, args.cron].filter((v) => v?.trim()).length;
  if (count !== 1) {
    throw new Error('Pass exactly one of at (ISO datetime), every (15m/1h/6h/1d), or cron');
  }
  if (args.at?.trim()) return { kind: 'once', at: args.at.trim() };
  if (args.every?.trim()) return { kind: 'every', every: args.every.trim() };
  return {
    kind: 'cron',
    expr: args.cron!.trim(),
    tz: args.tz?.trim() || undefined,
  };
}

/**
 * Local schedule tools (orchestration profile). Jobs persist in schedules.json
 * and fire from the desktop host via send / startOrchestration.
 */
export function registerScheduleTools(server: McpServer): void {
  server.tool(
    'list_schedules',
    'List local Sideboard schedules that trigger orchestration agents. Jobs fire only while Sideboard.app is running on this Mac (sleep skips until wake).',
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
    'Create a local schedule that, when due, sends a prompt to an orchestration chat (threadId) or starts a new Global orchestration chat (omit threadId). Pass threadId=self to continue this coordinator. Exactly one of at (ISO datetime), every (15m/1h/6h/1d), or cron (5-field). Recurring jobs without threadId open a new chat each run. Overnight/unattended runs need Settings → Advanced → Caffeinate while schedules are enabled, or set_caffeinate. Sideboard.app must be running for the job to fire.',
    {
      prompt: z.string().describe('User message / goal queued when the schedule fires'),
      name: z.string().optional(),
      at: z.string().optional().describe('ISO datetime for a one-shot'),
      every: z.string().optional().describe('Interval such as 15m, 1h, 6h, 1d'),
      cron: z.string().optional().describe('5-field cron expression'),
      tz: z.string().optional().describe('IANA timezone for cron (default: system)'),
      threadId: z
        .string()
        .optional()
        .describe(
          'Existing orchestration chat id, or "self" for this coordinator. Omit to create a new Global chat on fire.',
        ),
      agent: z
        .enum(['claude', 'cursor', 'codex', 'opencode'])
        .optional()
        .describe('Agent for a new Global chat (omit for Account default)'),
      model: z.string().optional(),
    },
    async (args) => {
      try {
        const when = parseWhen(args);
        const threadId = resolveScheduleThreadId(args.threadId);
        if (args.threadId?.trim().toLowerCase() === 'self' && !threadId) {
          return fail(
            new Error('threadId=self requires this turn to be an orchestration chat'),
          );
        }
        const schedule = createSchedule({
          name: args.name,
          prompt: args.prompt,
          when,
          threadId,
          agent: args.agent,
          model: args.model,
          createdBy: 'mcp',
        });
        return text({
          schedule,
          hint:
            'Fires while Sideboard.app is running. Recurring jobs without threadId create a new orchestration chat each run. Overnight runs need Settings → Advanced → Caffeinate while schedules are enabled, or set_caffeinate.',
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'update_schedule',
    'Update a local schedule (prompt, cadence, target thread, enabled). Pass id from list_schedules.',
    {
      id: z.string(),
      prompt: z.string().optional(),
      name: z.string().optional(),
      at: z.string().optional(),
      every: z.string().optional(),
      cron: z.string().optional(),
      tz: z.string().optional(),
      threadId: z
        .string()
        .optional()
        .describe('Existing orchestration chat, "self", or empty string to create a new chat each run'),
      agent: z.enum(['claude', 'cursor', 'codex', 'opencode']).optional(),
      model: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => {
      try {
        const cadenceSet = [args.at, args.every, args.cron].some((v) => v?.trim());
        const when = cadenceSet
          ? parseWhen({
              at: args.at,
              every: args.every,
              cron: args.cron,
              tz: args.tz,
            })
          : undefined;
        let threadId: string | null | undefined;
        if (args.threadId !== undefined) {
          threadId = resolveScheduleThreadId(args.threadId);
          if (args.threadId.trim().toLowerCase() === 'self' && !threadId) {
            return fail(
              new Error('threadId=self requires this turn to be an orchestration chat'),
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
        });
        return text({ schedule });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'delete_schedule',
    'Delete a local schedule. Pass id from list_schedules.',
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
    'Fire a schedule now (does not wait for nextRunAt). Queues the prompt or starts a new Global chat. If Sideboard.app is running, the desktop drains the turn.',
    { id: z.string() },
    async ({ id }) => {
      try {
        if (!getSchedule(id)) {
          return fail(new Error(`Schedule not found: ${id}`));
        }
        const schedule = await fireSchedule(id);
        return text({ schedule });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
