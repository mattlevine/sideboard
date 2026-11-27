import { randomUUID } from 'node:crypto';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import {
  listTicketsAssignedToMe,
  type AssignedTicket,
} from '../mcp/issue-vendor-tools.js';
import { ticketAssignOpensWorkspaceEnabled } from '../store/app-settings.js';
import {
  loadTicketAssignSnapshot,
  saveTicketAssignSnapshot,
  type TicketAssignSnapshot,
} from '../store/ticket-assign-snapshot.js';
import {
  postponeSchedule,
  recordScheduleRun,
  TICKET_ASSIGN_OFF_ERROR,
  type ScheduledTask,
} from '../store/schedules.js';
import { resolveNewThreadOptions } from '../store/thread-option-defaults.js';
import { listThreads } from '../store/thread-store.js';
import { listWorkspaces } from '../store/workspaces.js';
import type { AgentKind, Thread, ThreadAttachment } from '../types/thread.js';

/** Open at most this many new workspaces per check, so a burst cannot fork the machine. */
const TICKET_ASSIGN_OPEN_CAP = 3;

export type { TicketAssignSnapshot };

export interface TicketAssignOpen {
  repoPath: string;
  identifier: string;
  title: string;
  prompt: string;
  planMode: boolean;
  agent: AgentKind;
  model: string | null;
  effort: Thread['effort'];
  fast: boolean;
  autonomy: Thread['autonomy'];
  attachments: ThreadAttachment[];
}

export interface TicketAssignHooks {
  list: () => Promise<{ tickets: AssignedTicket[]; failedPrefixes: string[] } | null>;
  workspaces: () => { name: string; path: string }[];
  findExisting: (repoPath: string, identifier: string) => boolean;
  open: (input: TicketAssignOpen) => Promise<{ id: string }>;
}

let ticketAssignHooks: TicketAssignHooks | null = null;
/** First check after this process starts, or after the setting was off, only records. */
let ticketAssignNeedsBaseline = true;

/** Test injection for the ticket-assigned poll. */
export function setTicketAssignHooks(next: TicketAssignHooks | null): void {
  ticketAssignHooks = next;
}

export function resetTicketAssignWatch(): void {
  ticketAssignHooks = null;
  ticketAssignNeedsBaseline = true;
}

export function ticketAssignKey(ticket: {
  source: 'linear' | 'github';
  identifier: string;
  repoPath?: string;
}): string {
  const id = ticket.identifier.trim().toLowerCase();
  if (ticket.source === 'github') {
    return `github:${normalizeWorktreePath(ticket.repoPath ?? '')}:${id}`;
  }
  return `linear:${id}`;
}

export function sameTicketRef(a: string, b: string): boolean {
  const left = a.trim().toLowerCase().replace(/^#/, '');
  const right = b.trim().toLowerCase().replace(/^#/, '');
  return left.length > 0 && left === right;
}

/**
 * GitHub issues stay on the checkout they were listed from. Linear uses a
 * project or team name when several repos are registered, and the only repo
 * when there is just one.
 */
export function repoForAssignedTicket(
  ticket: AssignedTicket,
  workspaces: { name: string; path: string }[],
): string | null {
  const rows = workspaces
    .map((workspace) => ({
      path: workspace.path.trim(),
      norm: normalizeWorktreePath(workspace.path),
      name: workspace.name.trim().toLowerCase(),
      base: workspace.path.trim().split('/').filter(Boolean).pop()?.toLowerCase() ?? '',
    }))
    .filter((workspace) => workspace.path && workspace.path !== '/' && workspace.path !== '.');
  if (ticket.repoPath) {
    const norm = normalizeWorktreePath(ticket.repoPath);
    return rows.find((workspace) => workspace.norm === norm)?.path ?? null;
  }
  const labels = new Set(ticket.projects.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const named = rows.find(
    (workspace) => labels.has(workspace.name) || (workspace.base && labels.has(workspace.base)),
  );
  if (named) return named.path;
  if (rows.length === 1) return rows[0].path;
  return null;
}

export function planTicketAssignLatch(opts: {
  prev: string[];
  primed: boolean;
  observed: string[];
  failedPrefixes: string[];
}): { next: string[]; fresh: string[] } {
  const failed = (key: string) =>
    opts.failedPrefixes.some((prefix) => prefix.length > 0 && key.startsWith(prefix));
  const kept = opts.prev.filter((key) => failed(key));
  const prevSet = new Set(opts.prev);
  const fresh = opts.primed ? opts.observed.filter((key) => !prevSet.has(key)) : [];
  const next = [...new Set([...kept, ...opts.observed])].sort();
  return { next, fresh };
}

/** The old switch wrote this plan. An empty prompt uses the issue-create default instead. */
const LEGACY_TICKET_ASSIGN_PLAN_PROMPT =
  'Plan this ticket. Write the plan in this workspace. Do not implement it, do not open a pull request, and do not merge.';

/**
 * Same first turn as creating a workspace from an issue and leaving the prompt
 * empty: no text here, so createThread sends “Resolve this issue.” A typed
 * prompt replaces that, the way the create box does. Plan mode stays off
 * unless this automation turned it on.
 */
export function ticketAssignOpenPrompt(schedule: Pick<ScheduledTask, 'prompt' | 'planMode'>): {
  prompt: string;
  planMode: boolean;
} {
  const typed = schedule.prompt.trim();
  const legacyPlan = typed === LEGACY_TICKET_ASSIGN_PLAN_PROMPT;
  return {
    prompt: !typed || legacyPlan ? '' : typed,
    planMode: legacyPlan ? false : schedule.planMode === true,
  };
}

function ticketAssignHooksOrReal(): TicketAssignHooks {
  if (ticketAssignHooks) return ticketAssignHooks;
  return {
    list: () => listTicketsAssignedToMe(listWorkspaces().map((workspace) => workspace.path)),
    workspaces: () => listWorkspaces().map((workspace) => ({ name: workspace.name, path: workspace.path })),
    findExisting: (repoPath, identifier) =>
      listThreads().some(
        (thread) =>
          thread.status !== 'archived' &&
          thread.sourceType === 'ticket' &&
          normalizeWorktreePath(thread.repoPath) === normalizeWorktreePath(repoPath) &&
          sameTicketRef(thread.sourceRef, identifier),
      ),
    open: async (input) => {
      const { getOrchestrator } = await import('./orchestrator.js');
      const thread = await getOrchestrator().createThread({
        sourceType: 'ticket',
        sourceRef: input.identifier,
        repoPath: input.repoPath,
        agent: input.agent,
        model: input.model,
        effort: input.effort,
        fast: input.fast,
        autonomy: input.autonomy,
        planMode: input.planMode,
        title: input.title,
        prompt: input.prompt,
        attachments: input.attachments,
        reuseExisting: true,
      });
      return { id: thread.id };
    },
  };
}

interface TicketAssignPoll {
  threadId: string | null;
  error: string | null;
  /** No new ticket and no error: bump the clock without a run row. */
  quiet: boolean;
  holdBaseline: boolean;
}

async function pollTicketAssignments(
  schedule: ScheduledTask,
  opts: { baseline: boolean },
): Promise<TicketAssignPoll> {
  const hooks = ticketAssignHooksOrReal();
  const loaded = loadTicketAssignSnapshot();
  const primed = opts.baseline ? false : loaded.primed;
  let listed: { tickets: AssignedTicket[]; failedPrefixes: string[] } | null;
  try {
    listed = await hooks.list();
  } catch {
    listed = null;
  }
  if (!listed) {
    return {
      threadId: null,
      error: 'Could not list tickets assigned to you. The next check will retry.',
      quiet: false,
      holdBaseline: opts.baseline,
    };
  }
  const workspaces = hooks.workspaces();
  const placed = new Map<string, { ticket: AssignedTicket; repoPath: string }>();
  for (const ticket of listed.tickets) {
    const repoPath = repoForAssignedTicket(ticket, workspaces);
    if (!repoPath) continue;
    const key = ticketAssignKey({ ...ticket, repoPath: ticket.repoPath ?? repoPath });
    placed.set(key, { ticket, repoPath });
  }
  const planned = planTicketAssignLatch({
    prev: loaded.keys,
    primed,
    observed: [...placed.keys()],
    failedPrefixes: listed.failedPrefixes,
  });
  const fresh = planned.fresh.filter((key) => placed.has(key));
  const batch = fresh.slice(0, TICKET_ASSIGN_OPEN_CAP);
  const opened = new Set<string>();
  let threadId: string | null = null;
  let error: string | null = null;
  const defaults = resolveNewThreadOptions({
    ...(schedule.agent ? { agent: schedule.agent } : {}),
    ...(schedule.model ? { model: schedule.model } : schedule.agent ? { model: null } : {}),
    ...(schedule.effort ? { effort: schedule.effort } : {}),
    ...(schedule.fast != null ? { fast: schedule.fast } : {}),
    ...(schedule.autonomy ? { autonomy: schedule.autonomy } : {}),
  });
  for (const key of batch) {
    const row = placed.get(key);
    if (!row) continue;
    if (hooks.findExisting(row.repoPath, row.ticket.identifier)) {
      opened.add(key);
      continue;
    }
    try {
      const created = await hooks.open({
        repoPath: row.repoPath,
        identifier: row.ticket.identifier,
        title: row.ticket.title,
        ...ticketAssignOpenPrompt(schedule),
        agent: defaults.agent,
        model: defaults.model,
        effort: defaults.effort,
        fast: defaults.fast,
        autonomy: defaults.autonomy,
        attachments: [
          {
            id: randomUUID(),
            name: row.ticket.identifier,
            kind: 'issue',
            content: [
              `Linked issue: ${row.ticket.identifier} — ${row.ticket.title}`,
              row.ticket.url ? `URL: ${row.ticket.url}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });
      opened.add(key);
      threadId = created.id;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const freshSet = new Set(fresh);
  const nextKeys = planned.next.filter((key) => !freshSet.has(key) || opened.has(key));
  const next = { primed: true, keys: nextKeys };
  if (JSON.stringify(loaded) !== JSON.stringify({ primed: next.primed, keys: [...next.keys].sort() })) {
    saveTicketAssignSnapshot(next);
  }
  const quiet = !opts.baseline && loaded.primed && !threadId && !error && opened.size === fresh.length;
  return { threadId, error, quiet, holdBaseline: false };
}

export async function fireTicketAssigned(schedule: ScheduledTask): Promise<ScheduledTask> {
  if (!ticketAssignOpensWorkspaceEnabled()) {
    ticketAssignNeedsBaseline = true;
    if (schedule.lastError === TICKET_ASSIGN_OFF_ERROR) return postponeSchedule(schedule.id);
    return recordScheduleRun(schedule.id, { lastError: TICKET_ASSIGN_OFF_ERROR });
  }
  // Turning the switch off clears the snapshot prime, so re-enabling records
  // again even though this process already finished its first check.
  const baseline = ticketAssignNeedsBaseline || !loadTicketAssignSnapshot().primed;
  const result = await pollTicketAssignments(schedule, { baseline });
  if (result.holdBaseline) ticketAssignNeedsBaseline = true;
  else ticketAssignNeedsBaseline = false;
  if (result.quiet) return postponeSchedule(schedule.id);
  return recordScheduleRun(schedule.id, {
    ...(result.threadId ? { lastThreadId: result.threadId } : {}),
    lastError: result.error,
  });
}
