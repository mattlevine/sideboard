import type { AgentKind } from '../types/thread.js';
import {
  getOrchestrator,
  startOrchestration,
} from '../orchestrator/orchestrator.js';
import { resolveRepoRoot } from '../git/worktree.js';
import { listWorkspaces, type Workspace } from '../store/workspaces.js';
import {
  BrightsySideboardApi,
  taskMessageText,
  type SideboardCloudTask,
} from './api.js';

const POLL_MS = 5_000;
export const CLOUD_ORCHESTRATOR_GOAL = 'Cloud-connected Sideboard orchestrator';

export type CloudConnectAgent = Exclude<AgentKind, 'brightsy'>;

export interface CloudConnectOptions {
  /**
   * Home repo for the coordinator thread. Defaults to the first registered
   * workspace (or cwd). The coordinator can still operate across all workspaces.
   */
  repoPath?: string;
  agent: CloudConnectAgent;
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

export function formatWorkspaceInventory(workspaces: Workspace[]): string {
  if (workspaces.length === 0) return '(no registered workspaces)';
  return workspaces.map((w) => `- ${w.name}: ${w.path}`).join('\n');
}

export function coordinatorSystemPrompt(opts: {
  goal: string;
  homeRepoPath: string;
  parentId: string;
  workspaces: Workspace[];
}): string {
  return [
    'You are a Sideboard coordinator responding to a request from a Brightsy cloud agent (Slack, Discord, Teams, or other chat).',
    'Your reply will be sent back to that cloud agent — be concise and actionable.',
    'You operate the global orchestrator across ALL registered workspaces below.',
    'Use Sideboard MCP tools (list_workspaces, list_threads, create_thread, send_to_thread, wait_for_turn, get_diff, …).',
    'When creating threads, pass the correct repoPath for the target workspace.',
    'You cannot confirm_land or purge_thread — those stay human-only.',
    `Goal: ${opts.goal}`,
    `Coordinator home repo: ${opts.homeRepoPath}`,
    `Parent thread id (pass as parentThreadId when creating children): ${opts.parentId}`,
    'Registered workspaces:',
    formatWorkspaceInventory(opts.workspaces),
  ].join('\n');
}

async function resolveHomeRepo(preferred?: string): Promise<string> {
  if (preferred) {
    try {
      return await resolveRepoRoot(preferred);
    } catch {
      // fall through to workspace list / cwd
    }
  }
  const workspaces = listWorkspaces();
  if (workspaces[0]) {
    try {
      return await resolveRepoRoot(workspaces[0].path);
    } catch {
      return workspaces[0].path;
    }
  }
  return resolveRepoRoot(process.cwd()).catch(() => process.cwd());
}

function refreshWorkspaces(homeRepoPath: string): Workspace[] {
  const orch = getOrchestrator();
  // Ensure home is registered, then sync from threads.
  void orch.addWorkspace(homeRepoPath).catch(() => undefined);
  return orch.listWorkspaces();
}

async function ensureCoordinator(homeRepoPath: string, agent: CloudConnectAgent) {
  const orch = getOrchestrator();
  await orch.reconcile(homeRepoPath);
  const existing = orch
    .getThreads(true)
    .find(
      (t) =>
        t.sourceType === 'orchestration' &&
        (t.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
          t.title === CLOUD_ORCHESTRATOR_GOAL),
    );
  if (existing) return existing;
  return startOrchestration({
    goal: CLOUD_ORCHESTRATOR_GOAL,
    agent,
    repoPath: homeRepoPath,
  });
}

async function handleTask(
  api: BrightsySideboardApi,
  task: SideboardCloudTask,
  opts: CloudConnectOptions,
  homeRepoPath: string,
): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  const message = taskMessageText(task);
  if (!message) {
    log(`skip ${task.id.slice(0, 8)}: empty message`);
    return;
  }

  if (task.task_status === 'awaiting_confirmation') {
    log(`approve ${task.id.slice(0, 8)}`);
    await api.approveTask(task.id);
    task = { ...task, task_status: 'pending' };
  }

  if (task.task_status !== 'pending' && task.task_status !== 'running') {
    return;
  }

  const workspaces = refreshWorkspaces(homeRepoPath);
  for (const ws of workspaces) {
    await getOrchestrator().reconcile(ws.path).catch(() => undefined);
  }

  const coordinator = await ensureCoordinator(homeRepoPath, opts.agent);

  log(
    `run ${task.id.slice(0, 8)} → coordinator ${coordinator.id.slice(0, 8)} (${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'})`,
  );
  await api.markRunning(task.id).catch(() => undefined);

  const orch = getOrchestrator();
  const prompt = [
    coordinatorSystemPrompt({
      goal: coordinator.sourceRef || CLOUD_ORCHESTRATOR_GOAL,
      homeRepoPath,
      parentId: coordinator.id,
      workspaces,
    }),
    '',
    '--- Cloud agent request ---',
    message,
  ].join('\n');

  await orch.send(coordinator.id, prompt);
  await orch.waitForTurn(coordinator.id, 14 * 60 * 1000);
  const result = orch.getTurnResult(coordinator.id);
  const reply =
    result.text.trim() ||
    `(coordinator finished with status ${result.status}, no text)`;

  await api.submitResponse(task.id, reply);
  log(`replied ${task.id.slice(0, 8)} (${reply.length} chars)`);
}

/**
 * Poll Brightsy desktop inbound tasks and route them to the local
 * global orchestrator (coordinator thread + MCP across all workspaces).
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
  const homeRepoPath = await resolveHomeRepo(opts.repoPath);
  const workspaces = refreshWorkspaces(homeRepoPath);

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
  log(`Coordinator home: ${homeRepoPath}  agent: ${opts.agent}`);
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
        void handleTask(api, task, opts, homeRepoPath)
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
