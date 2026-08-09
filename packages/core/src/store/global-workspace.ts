import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import {
  allocateTeamName,
  takenSlugsFromThread,
  teamSlugFromName,
} from '../git/teams.js';
import { ensureGlobalCoordinatorCwd } from '../orchestrator/coordinator-prompt.js';
import type { AgentKind, Thread, ThreadAttachment, Autonomy } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';
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

/** True for Global chats and legacy pinned-repo orchestration threads. */
export function isOrchestratorThread(
  thread: Pick<Thread, 'sourceType' | 'repoPath'> | null | undefined,
): boolean {
  return Boolean(
    thread &&
      (thread.sourceType === 'orchestration' || isGlobalThread(thread)),
  );
}

/**
 * True when a Global/orchestrator Claude session acted like a worktree coder
 * (Bash/Read/etc) without ever calling Sideboard MCP — resume would keep that
 * wrong identity ("empty worktree / not a git repo").
 */
export function orchestratorSessionPoisonedByBuiltins(
  thread: Pick<Thread, 'messages'> | null | undefined,
): boolean {
  if (!thread?.messages?.length) return false;
  let usedBuiltin = false;
  let usedSideboardMcp = false;
  for (const msg of thread.messages) {
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue;
      if (part.name.startsWith('mcp__sideboard')) {
        usedSideboardMcp = true;
      } else if (
        part.name === 'Bash' ||
        part.name === 'Edit' ||
        part.name === 'Write' ||
        part.name === 'Read' ||
        part.name === 'Glob' ||
        part.name === 'Grep'
      ) {
        usedBuiltin = true;
      }
    }
  }
  return usedBuiltin && !usedSideboardMcp;
}

export function isCloudCoordinatorThread(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title' | 'repoPath'>,
): boolean {
  // Identity is sourceRef (title is a soccer nickname). Legacy threads used the
  // cloud goal string as title before nicknames.
  if (thread.sourceRef === CLOUD_ORCHESTRATOR_GOAL) {
    return isGlobalThread(thread) || thread.sourceType === 'orchestration';
  }
  if (thread.title === CLOUD_ORCHESTRATOR_GOAL) {
    return isGlobalThread(thread) || thread.sourceType === 'orchestration';
  }
  return false;
}

/** True when an orchestration chat still needs a soccer-team nickname. */
export function orchestrationTitleNeedsSoccerNickname(
  thread: Pick<
    Thread,
    'title' | 'sourceRef' | 'sourceType' | 'repoPath' | 'userSetTitle'
  >,
): boolean {
  if (!isOrchestratorThread(thread)) return false;
  const title = thread.title?.trim() ?? '';
  if (teamSlugFromName(title)) return false;
  // Always replace the old fixed cloud label.
  if (title === CLOUD_ORCHESTRATOR_GOAL) return true;
  if (!title || title === 'Untitled') return true;
  // Keep explicit renames / create titles; only heal legacy goal-as-title.
  if (thread.userSetTitle) return false;
  if (thread.sourceRef?.trim() && title === thread.sourceRef.trim()) return true;
  return false;
}

export interface CreateGlobalChatOpts {
  title?: string;
  agent: AgentKind;
  /** Goal / cloud marker on sourceRef. Title is always a soccer nickname. Cloud uses CLOUD_ORCHESTRATOR_GOAL as sourceRef. */
  sourceRef?: string;
  autonomy?: Autonomy;
  model?: string | null;
  effort?: ThinkingEffort;
  fast?: boolean;
  planMode?: boolean;
  attachments?: ThreadAttachment[];
  parentThreadId?: string | null;
}

/** Soccer-team slugs already used by active threads (orchestration + worktrees). */
export function takenTeamSlugsForOrchestration(): string[] {
  const taken = new Set<string>(['global']);
  for (const thread of listThreads({ includeArchived: true })) {
    if (thread.status === 'archived') continue;
    for (const slug of takenSlugsFromThread(thread)) {
      taken.add(slug);
    }
  }
  return [...taken];
}

/** Create a home-less orchestration chat under the Global workspace. */
export function createGlobalChat(opts: CreateGlobalChatOpts): Thread {
  ensureGlobalCoordinatorCwd();
  const isCloud =
    opts.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
    opts.title?.trim() === CLOUD_ORCHESTRATOR_GOAL;
  const explicit = opts.title?.trim();
  // Display name: soccer nickname (like worktree chats), including the cloud
  // singleton. Goal / cloud marker stays on sourceRef — never the tab label.
  const title =
    explicit && explicit !== CLOUD_ORCHESTRATOR_GOAL
      ? explicit
      : allocateTeamName(takenTeamSlugsForOrchestration()).name;
  const sourceRef =
    opts.sourceRef?.trim() || (isCloud ? CLOUD_ORCHESTRATOR_GOAL : title);
  const thread = createEmptyThread({
    title,
    // Stick nicknames the same way chat tabs do (avoid later sync overwrites).
    userSetTitle: true,
    sourceType: 'orchestration',
    sourceRef,
    branchName: 'global',
    worktreePath: globalAgentCwd(),
    repoPath: GLOBAL_WORKSPACE_ID,
    agent: opts.agent,
    autonomy: opts.autonomy ?? 'default',
    model: opts.model ?? null,
    effort: opts.effort ?? 'high',
    fast: Boolean(opts.fast),
    planMode: Boolean(opts.planMode),
    attachments: opts.attachments ?? [],
    parentThreadId: opts.parentThreadId ?? null,
    status: 'idle',
  });
  writeThread(thread);
  return thread;
}

/**
 * Assign soccer nicknames to orchestration chats still using the cloud goal
 * string, Untitled, or goal-as-title. Called from reconcile.
 */
export function healOrchestrationSoccerTitles(): number {
  let healed = 0;
  const taken = new Set(takenTeamSlugsForOrchestration());
  for (const thread of listThreads({ includeArchived: true })) {
    if (thread.status === 'archived') continue;
    if (!orchestrationTitleNeedsSoccerNickname(thread)) continue;
    const team = allocateTeamName(taken);
    taken.add(team.slug);
    updateThread(thread.id, { title: team.name, userSetTitle: true });
    healed += 1;
  }
  return healed;
}

export function listGlobalThreads(includeArchived = false): Thread[] {
  return listThreads({ includeArchived }).filter(
    (t) => t.repoPath === GLOBAL_WORKSPACE_ID,
  );
}

function findCloudCoordinator(): Thread | undefined {
  return listThreads({ includeArchived: true }).find(
    (t) => t.status !== 'archived' && isCloudCoordinatorThread(t),
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
    sourceRef: CLOUD_ORCHESTRATOR_GOAL,
    agent,
  });
  // Prefer the oldest matching coordinator if two were created in a race.
  const all = listThreads({ includeArchived: true })
    .filter(
      (t) =>
        t.status !== 'archived' &&
        isCloudCoordinatorThread(t),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all[0] ?? created;
}
