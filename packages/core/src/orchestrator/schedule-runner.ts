import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coerceOrchestratorAgent,
  type OrchestratorAgentKind,
} from '../agents/orchestrator-capable.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import {
  listTicketsAssignedToMe,
  type AssignedTicket,
} from '../mcp/issue-vendor-tools.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import {
  resolveOrchestratorDefaults,
  ticketAssignOpensWorkspaceEnabled,
} from '../store/app-settings.js';
import { appDataDir } from '../store/paths.js';
import { writePrivateFile } from '../store/private-file.js';
import {
  deleteSchedule,
  getSchedule,
  listSchedules,
  postponeSchedule,
  recordScheduleRun,
  TICKET_ASSIGN_OFF_ERROR,
  TICKET_ASSIGN_PLAN_PROMPT,
  type ScheduledTask,
} from '../store/schedules.js';
import { resolveNewThreadOptions } from '../store/thread-option-defaults.js';
import { findThreadByRef, listThreads } from '../store/thread-store.js';
import { listWorkspaces } from '../store/workspaces.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import type { AgentKind, Thread, ThreadAttachment, ThreadOptionsPatch } from '../types/thread.js';

/** Open at most this many new workspaces per check, so a burst cannot fork the machine. */
const TICKET_ASSIGN_OPEN_CAP = 3;

export interface TicketAssignSnapshot {
  primed: boolean;
  keys: string[];
}

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
  ticketAssignHooks = null;
  ticketAssignNeedsBaseline = true;
}

/** Test injection for the ticket-assigned poll. */
export function setTicketAssignHooks(next: TicketAssignHooks | null): void {
  ticketAssignHooks = next;
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

export function ticketAssignSnapshotPath(): string {
  return join(appDataDir(), 'ticket-assign-watch.json');
}

export function emptyTicketAssignSnapshot(): TicketAssignSnapshot {
  return { primed: false, keys: [] };
}

export function loadTicketAssignSnapshot(): TicketAssignSnapshot {
  try {
    const path = ticketAssignSnapshotPath();
    if (!existsSync(path)) return emptyTicketAssignSnapshot();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { primed?: unknown; keys?: unknown };
    const keys: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.keys)) {
      for (const item of raw.keys) {
        const key = typeof item === 'string' ? item.trim() : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
    return { primed: raw.primed === true, keys };
  } catch {
    return emptyTicketAssignSnapshot();
  }
}

export function saveTicketAssignSnapshot(snapshot: TicketAssignSnapshot): void {
  const keys = [...new Set(snapshot.keys.map((key) => key.trim()).filter(Boolean))].sort();
  writePrivateFile(
    ticketAssignSnapshotPath(),
    `${JSON.stringify({ primed: snapshot.primed === true, keys }, null, 2)}\n`,
  );
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

export function formatTicketAssignPrompt(
  prompt: string,
  ticket: { identifier: string; title: string; url: string },
): string {
  const goal = prompt.trim() || TICKET_ASSIGN_PLAN_PROMPT;
  const title = ticket.title.trim() || ticket.identifier;
  const lines = [
    `[Ticket assigned: ${ticket.identifier}]`,
    goal,
    '',
    `${ticket.identifier} — ${title}`,
  ];
  const url = ticket.url.trim();
  if (url) lines.push(url);
  lines.push('', 'Do not merge. This opened a workspace and started a plan. Merging stays with a person.');
  return lines.join('\n');
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
        prompt: formatTicketAssignPrompt(schedule.prompt, row.ticket),
        planMode: schedule.planMode !== false,
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

async function fireTicketAssigned(schedule: ScheduledTask): Promise<ScheduledTask> {
  if (!ticketAssignOpensWorkspaceEnabled()) {
    ticketAssignNeedsBaseline = true;
    if (schedule.lastError === TICKET_ASSIGN_OFF_ERROR) return postponeSchedule(schedule.id);
    return recordScheduleRun(schedule.id, { lastError: TICKET_ASSIGN_OFF_ERROR });
  }
  const baseline = ticketAssignNeedsBaseline;
  const result = await pollTicketAssignments(schedule, { baseline });
  if (result.holdBaseline) ticketAssignNeedsBaseline = true;
  else ticketAssignNeedsBaseline = false;
  if (result.quiet) return postponeSchedule(schedule.id);
  return recordScheduleRun(schedule.id, {
    ...(result.threadId ? { lastThreadId: result.threadId } : {}),
    lastError: result.error,
  });
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
    if (schedule.when.kind === 'ticket-assigned') return await fireTicketAssigned(schedule);
    const deps = fireHooks ?? (await defaultDeps());
    const prompt = formatScheduledPrompt(schedule.name, schedule.prompt);
    const target = schedule.threadId ? deps.findThread(schedule.threadId) : null;
    if (schedule.threadId && (!target || target.status === 'archived')) {
      deleteSchedule(schedule.id);
      return {
        ...schedule,
        enabled: false,
        lastError: 'Removed because its chat is archived or gone.',
      };
    }
    if (target) {
      const sent = await deps.send(target.id, prompt, {
        attachments: schedule.attachments,
        options: scheduleSendOptions(schedule),
      });
      return recordScheduleRun(schedule.id, {
        lastThreadId: sent.id,
        lastError: null,
      });
    }
    // A Global job (no chat) opens a fresh chat. Archive it when the run
    // finishes unless archiveChat is off, so a morning run can stay open.
    const archiveFresh = schedule.archiveChat !== false;
    const created = await deps.startOrchestration({
      goal: prompt,
      agent: pickAgent(schedule),
      model: schedule.model,
      ...(schedule.effort ? { effort: schedule.effort } : {}),
      ...(schedule.fast != null ? { fast: schedule.fast } : {}),
      ...(schedule.planMode != null ? { planMode: schedule.planMode } : {}),
      ...(schedule.autonomy ? { autonomy: schedule.autonomy } : {}),
      attachments: schedule.attachments,
      ...(archiveFresh ? { ephemeralAutomationId: schedule.id } : {}),
      ephemeralTitle: schedule.name,
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
