import type { AgentKind } from '../types/thread.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import {
  ensureCloudCoordinator,
  listGlobalThreads,
} from '../store/global-workspace.js';
import {
  BrightsySideboardApi,
  taskMessageText,
  type SideboardCloudTask,
} from './api.js';
import {
  CLOUD_COORDINATOR_BUSY_REPLY,
  CLOUD_COORDINATOR_STOPPED_REPLY,
  CLOUD_COORDINATOR_TIMEOUT_REPLY,
  CLOUD_ORCHESTRATOR_GOAL,
  parseForceStopMessage,
} from './cloud-connect-constants.js';
import { readThread } from '../store/thread-store.js';
import {
  coordinatorSystemPrompt,
  enrichWorkspacesWithGithub,
  formatWorkspaceInventory,
} from '../orchestrator/coordinator-prompt.js';

export {
  CLOUD_COORDINATOR_BUSY_REPLY,
  CLOUD_COORDINATOR_STOPPED_REPLY,
  CLOUD_COORDINATOR_TIMEOUT_REPLY,
  CLOUD_ORCHESTRATOR_GOAL,
  parseForceStopMessage,
  SIDEBOARD_FORCE_STOP,
} from './cloud-connect-constants.js';

export {
  coordinatorSystemPrompt,
  formatWorkspaceInventory,
  enrichWorkspacesWithGithub,
} from '../orchestrator/coordinator-prompt.js';

const POLL_MS = 5_000;

/** Serialize cloud task handling so busy checks / sends cannot interleave. */
let handleTaskChain: Promise<void> = Promise.resolve();

function enqueueHandleTask(fn: () => Promise<void>): Promise<void> {
  const run = handleTaskChain.then(fn, fn);
  handleTaskChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type CloudConnectAgent = Exclude<AgentKind, 'brightsy'>;

export interface CloudConnectOptions {
  agent: CloudConnectAgent;
  /** @deprecated Ignored — cloud connect uses the Global workspace coordinator. */
  repoPath?: string;
  /** Auto-enable Brightsy desktop access if disabled. Default true. */
  enableAccess?: boolean;
  /** When enabling access, set allow_always. Default true for connect daemon. */
  allowAlways?: boolean;
  pollIntervalMs?: number;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  /** Prefer Electron `net.fetch` when running in the desktop main process. */
  fetchImpl?: typeof fetch;
  /** Optional pre-built API client (tests / custom auth). */
  api?: BrightsySideboardApi;
}

function refreshWorkspaces() {
  const orch = getOrchestrator();
  return orch.listWorkspaces();
}

async function handleTask(
  api: BrightsySideboardApi,
  task: SideboardCloudTask,
  opts: CloudConnectOptions,
): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  let message = taskMessageText(task);
  if (!message) {
    log(`skip ${task.id.slice(0, 8)}: empty message`);
    return;
  }

  if (task.task_status !== 'pending' && task.task_status !== 'running' && task.task_status !== 'awaiting_confirmation') {
    return;
  }

  const workspaces = refreshWorkspaces();
  for (const ws of workspaces) {
    await getOrchestrator().reconcile(ws.path).catch(() => undefined);
  }
  const inventory = await enrichWorkspacesWithGithub(workspaces);

  // Re-read coordinator after serialization so busy checks see prior sends.
  const coordinator = ensureCloudCoordinator(opts.agent);
  let fresh = readThread(coordinator.id) ?? coordinator;

  const parsed = parseForceStopMessage(message);
  if (parsed.forceStop) {
    // Idempotent stop (poll loop may already have interrupted an in-flight turn).
    try {
      getOrchestrator().stop(fresh.id);
      log(`force-stop ${task.id.slice(0, 8)} → coordinator ${fresh.id.slice(0, 8)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`force-stop ${task.id.slice(0, 8)}: ${msg}`);
    }

    if (!parsed.remainder) {
      if (task.task_status === 'awaiting_confirmation') {
        await api.approveTask(task.id).catch(() => undefined);
      }
      await api.markRunning(task.id).catch(() => undefined);
      await api.submitResponse(task.id, CLOUD_COORDINATOR_STOPPED_REPLY);
      log(`replied stopped ${task.id.slice(0, 8)}`);
      return;
    }

    // Strip token and continue with the follow-up request.
    message = parsed.remainder;
    fresh = readThread(coordinator.id) ?? ensureCloudCoordinator(opts.agent);
  }

  // Busy: non-AI reply — do not interrupt, queue, or spawn a sibling.
  // Check before approve so we do not mutate server state when busy.
  if (fresh.status === 'running' || fresh.status === 'queued') {
    log(
      `busy ${task.id.slice(0, 8)} → coordinator ${fresh.id.slice(0, 8)} (${fresh.status})`,
    );
    if (task.task_status === 'awaiting_confirmation') {
      await api.approveTask(task.id).catch(() => undefined);
    }
    await api.markRunning(task.id).catch(() => undefined);
    await api.submitResponse(task.id, CLOUD_COORDINATOR_BUSY_REPLY);
    log(`replied busy ${task.id.slice(0, 8)}`);
    return;
  }

  if (task.task_status === 'awaiting_confirmation') {
    log(`approve ${task.id.slice(0, 8)}`);
    await api.approveTask(task.id);
    task = { ...task, task_status: 'pending' };
  }

  log(
    `run ${task.id.slice(0, 8)} → coordinator ${fresh.id.slice(0, 8)} (${inventory.length} workspace${inventory.length === 1 ? '' : 's'})`,
  );
  await api.markRunning(task.id).catch(() => undefined);

  const orch = getOrchestrator();
  const prompt = [
    coordinatorSystemPrompt({
      goal: fresh.sourceRef || CLOUD_ORCHESTRATOR_GOAL,
      parentId: fresh.id,
      workspaces: inventory,
      audience: 'cloud',
    }),
    '',
    '--- Cloud agent request ---',
    message,
  ].join('\n');

  try {
    await orch.send(fresh.id, prompt);
    await orch.waitForTurn(fresh.id, 14 * 60 * 1000);
    const result = orch.getTurnResult(fresh.id);
    const reply =
      result.text.trim() ||
      `(coordinator finished with status ${result.status}, no text)`;
    await api.submitResponse(task.id, reply);
    log(`replied ${task.id.slice(0, 8)} (${reply.length} chars)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /timed out|timeout/i.test(msg);
    const reply = timedOut
      ? CLOUD_COORDINATOR_TIMEOUT_REPLY
      : `Sideboard coordinator error: ${msg}`;
    await api.submitResponse(task.id, reply).catch(() => undefined);
    log(`replied error ${task.id.slice(0, 8)}: ${msg}`);
    if (!timedOut) throw err;
  }
}

/**
 * Poll Brightsy desktop inbound tasks and route them to the local
 * global orchestrator (coordinator chat + MCP across all workspaces).
 */
export async function runCloudConnect(opts: CloudConnectOptions): Promise<void> {
  const log = opts.onLog ?? console.log;
  const api =
    opts.api ??
    new BrightsySideboardApi(
      opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : undefined,
    );
  const enableAccess = opts.enableAccess !== false;
  const allowAlways = opts.allowAlways !== false;
  const pollMs = opts.pollIntervalMs ?? POLL_MS;
  const workspaces = refreshWorkspaces();
  const coordinator = ensureCloudCoordinator(opts.agent);

  const access = await api.getAccess();
  if (!access.enabled) {
    if (!enableAccess) {
      throw new Error(
        'Brightsy desktop access is disabled. Enable Cloud messages in Sideboard Settings → Brightsy, or Brightsy User Settings.',
      );
    }
    log('Enabling Brightsy desktop access…');
    await api.setAccess(true, allowAlways);
  } else if (allowAlways && !access.allow_always) {
    await api.setAccess(true, true);
  }

  log(
    `Connected to Brightsy (${api.endpoint}). Polling desktop tasks every ${pollMs / 1000}s…`,
  );
  log(
    `Global coordinator: ${coordinator.id.slice(0, 8)}  agent: ${opts.agent}  global chats: ${listGlobalThreads().length}`,
  );
  log(`Workspaces (${workspaces.length}):`);
  for (const line of formatWorkspaceInventory(workspaces).split('\n')) {
    log(`  ${line}`);
  }

  const inFlight = new Set<string>();
  let consecutivePollFailures = 0;

  while (!opts.signal?.aborted) {
    try {
      const hadFailures = consecutivePollFailures > 0;
      const [pending, awaiting, running] = await Promise.all([
        api.getTasks('pending'),
        api.getTasks('awaiting_confirmation'),
        api.getTasks('running'),
      ]);
      consecutivePollFailures = 0;
      if (hadFailures) log('poll recovered');
      const tasks = [...awaiting, ...pending, ...running];
      for (const task of tasks) {
        if (inFlight.has(task.id)) continue;
        // Skip running tasks we didn't start in this process
        if (task.task_status === 'running') continue;
        inFlight.add(task.id);
        const message = taskMessageText(task);
        // Force-stop must interrupt immediately — do not wait for the
        // serialized handleTask queue (unblocks in-flight send/waitForTurn).
        if (message && parseForceStopMessage(message).forceStop) {
          try {
            getOrchestrator().stop(ensureCloudCoordinator(opts.agent).id);
            log(
              `force-stop interrupt ${task.id.slice(0, 8)} → coordinator`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`force-stop interrupt ${task.id.slice(0, 8)}: ${msg}`);
          }
        }
        void enqueueHandleTask(() => handleTask(api, task, opts))
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log(`error ${task.id.slice(0, 8)}: ${msg}`);
          })
          .finally(() => inFlight.delete(task.id));
      }
    } catch (err) {
      consecutivePollFailures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      // One soft retry before surfacing — brief VPN/DNS blips are common.
      if (consecutivePollFailures === 1) {
        log(`poll retry: ${msg}`);
      } else {
        log(`poll error: ${msg}`);
      }
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, pollMs);
      opts.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
