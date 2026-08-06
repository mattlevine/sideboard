import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import type { AgentKind, Thread, ThreadAttachment, Autonomy } from '../types/thread.js';
import { globalAgentCwd } from './paths.js';
import {
  createEmptyThread,
  listThreads,
  writeThread,
  updateThread,
} from './thread-store.js';

/** Sentinel repoPath for the home-less global orchestration workspace. */
export const GLOBAL_WORKSPACE_ID = '__global__';

export function isGlobalThread(
  thread: Pick<Thread, 'repoPath'> | null | undefined,
): boolean {
  return Boolean(thread && thread.repoPath === GLOBAL_WORKSPACE_ID);
}

export function isGlobalRepoPath(repoPath: string | null | undefined): boolean {
  return repoPath === GLOBAL_WORKSPACE_ID;
}

export { globalAgentCwd };

export function isCloudCoordinatorThread(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title'>,
): boolean {
  if (thread.sourceType !== 'orchestration') return false;
  return (
    thread.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
    thread.title === CLOUD_ORCHESTRATOR_GOAL
  );
}

export interface CreateGlobalChatOpts {
  title?: string;
  agent: AgentKind;
  /** Defaults to title or 'Global chat'. Cloud coordinator uses CLOUD_ORCHESTRATOR_GOAL. */
  sourceRef?: string;
  autonomy?: Autonomy;
  model?: string | null;
  fast?: boolean;
  planMode?: boolean;
  attachments?: ThreadAttachment[];
  parentThreadId?: string | null;
}

/** Create a home-less orchestration chat under the Global workspace. */
export function createGlobalChat(opts: CreateGlobalChatOpts): Thread {
  const title =
    opts.title?.trim() ||
    (opts.sourceRef === CLOUD_ORCHESTRATOR_GOAL
      ? CLOUD_ORCHESTRATOR_GOAL
      : 'Global chat');
  const sourceRef = opts.sourceRef?.trim() || title;
  const thread = createEmptyThread({
    title,
    userSetTitle: Boolean(opts.title?.trim()) || sourceRef === CLOUD_ORCHESTRATOR_GOAL,
    sourceType: 'orchestration',
    sourceRef,
    branchName: 'global',
    worktreePath: globalAgentCwd(),
    repoPath: GLOBAL_WORKSPACE_ID,
    agent: opts.agent,
    autonomy: opts.autonomy ?? 'default',
    model: opts.model ?? null,
    fast: Boolean(opts.fast),
    planMode: Boolean(opts.planMode),
    attachments: opts.attachments ?? [],
    parentThreadId: opts.parentThreadId ?? null,
    status: 'idle',
  });
  writeThread(thread);
  return thread;
}

export function listGlobalThreads(includeArchived = false): Thread[] {
  return listThreads({ includeArchived }).filter(
    (t) => t.repoPath === GLOBAL_WORKSPACE_ID,
  );
}

function findCloudCoordinator(): Thread | undefined {
  return listThreads({ includeArchived: true }).find(
    (t) =>
      t.status !== 'archived' &&
      t.sourceType === 'orchestration' &&
      (t.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
        t.title === CLOUD_ORCHESTRATOR_GOAL),
  );
}

/** Find or create the singleton Brightsy cloud coordinator under Global. */
export function ensureCloudCoordinator(agent: AgentKind): Thread {
  // Sync find+create is atomic on the JS event loop; re-check after create
  // in case a concurrent caller already wrote the singleton.
  const existing = findCloudCoordinator();
  if (existing) {
    // Migrate legacy home-repo cloud coordinators onto Global.
    if (existing.repoPath !== GLOBAL_WORKSPACE_ID) {
      return updateThread(existing.id, {
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: globalAgentCwd(),
        branchName: 'global',
      });
    }
    return existing;
  }
  const created = createGlobalChat({
    title: CLOUD_ORCHESTRATOR_GOAL,
    sourceRef: CLOUD_ORCHESTRATOR_GOAL,
    agent,
  });
  // Prefer the oldest matching coordinator if two were created in a race.
  const all = listThreads({ includeArchived: true })
    .filter(
      (t) =>
        t.status !== 'archived' &&
        t.sourceType === 'orchestration' &&
        (t.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
          t.title === CLOUD_ORCHESTRATOR_GOAL),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all[0] ?? created;
}
