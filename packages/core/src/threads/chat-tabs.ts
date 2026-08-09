import { randomUUID } from 'node:crypto';
import { formatMessagesAsTranscript } from '../composer/context-compact.js';
import {
  allocateTeamName,
  takenSlugsFromThread,
} from '../git/teams.js';
import {
  normalizeWorktreePath,
  worktreeNameFromPath,
} from '../git/worktree-labels.js';
import { isGlobalThread, isOrchestratorThread } from '../store/global-workspace.js';
import { assertOrchestratorCapableAgent } from '../agents/orchestrator-capable.js';
import {
  createEmptyThread,
  findThreadByRef,
  listThreads,
  writeThread,
} from '../store/thread-store.js';
import type {
  CreateChatTabInput,
  ForkChatTabInput,
  Thread,
  ThreadAttachment,
  ThreadMessage,
} from '../types/thread.js';

export { normalizeWorktreePath } from '../git/worktree-labels.js';

export function sameWorktreePath(a: string, b: string): boolean {
  return normalizeWorktreePath(a) === normalizeWorktreePath(b);
}

/** Soccer-team slugs already used by this worktree or sibling tab titles. */
export function takenTeamSlugsForChatTab(worktreePath: string): string[] {
  const key = normalizeWorktreePath(worktreePath);
  const taken = new Set<string>();
  const dir = worktreeNameFromPath(key);
  if (dir) taken.add(dir.toLowerCase());

  for (const sibling of threadsSharingWorktree(key)) {
    for (const slug of takenSlugsFromThread(sibling)) {
      taken.add(slug);
    }
  }
  return [...taken];
}

function requireThread(idOrRef: string): Thread {
  const thread = findThreadByRef(idOrRef) ?? null;
  if (!thread) throw new Error(`Thread not found: ${idOrRef}`);
  return thread;
}

/** Workspace/git fields shared by all chat tabs in one worktree. */
function worktreeBindingFrom(from: Thread): Pick<
  Thread,
  | 'worktreePath'
  | 'repoPath'
  | 'branchName'
  | 'sourceRef'
  | 'sourceType'
  | 'sourceIsFork'
  | 'parentThreadId'
  | 'prUrl'
  | 'prTitle'
> {
  return {
    worktreePath: normalizeWorktreePath(from.worktreePath),
    repoPath: from.repoPath,
    branchName: from.branchName,
    sourceRef: from.sourceRef,
    // Legacy pinned-repo orchestration: new tabs become normal worktree agents.
    // Global: keep orchestration so chat tabs stay fleet orchestrators (MCP + Bash).
    sourceType: isGlobalThread(from)
      ? 'orchestration'
      : from.sourceType === 'orchestration'
        ? 'branch'
        : from.sourceType,
    sourceIsFork: from.sourceIsFork,
    parentThreadId: from.parentThreadId,
    prUrl: from.prUrl,
    prTitle: from.prTitle,
  };
}

export function threadsSharingWorktree(worktreePath: string): Thread[] {
  const key = normalizeWorktreePath(worktreePath);
  return listThreads({ includeArchived: true })
    .filter((t) => sameWorktreePath(t.worktreePath, key) && t.status !== 'archived')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function formatTranscriptMarkdown(title: string, messages: ThreadMessage[]): string {
  // Full tool inputs/results — this attachment is sent to the agent on the next turn.
  const body = formatMessagesAsTranscript(messages, { tools: 'full' });
  return [`# Transcript: ${title}`, '', `Forked ${new Date().toISOString()}`, '', body].join('\n');
}

export function forkMessageSlice(from: Thread, throughIndex?: number): ThreadMessage[] {
  const through =
    throughIndex === undefined
      ? from.messages.length - 1
      : Math.min(throughIndex, from.messages.length - 1);
  return through >= 0 ? from.messages.slice(0, through + 1) : [];
}

export function buildForkTranscriptAttachment(
  baseTitle: string,
  messages: ThreadMessage[],
): ThreadAttachment {
  const title = baseTitle || 'Chat';
  return {
    id: randomUUID(),
    name: `Transcript of ${title}.md`,
    kind: 'transcript',
    content: formatTranscriptMarkdown(title, messages),
  };
}

/** New chat tab in the same worktree (no new git worktree). */
export function createChatTab(input: CreateChatTabInput): Thread {
  const from = requireThread(input.fromThreadId);
  const binding = worktreeBindingFrom(from);

  const explicitTitle = input.title?.trim();
  const title =
    explicitTitle ||
    allocateTeamName(takenTeamSlugsForChatTab(binding.worktreePath)).name;

  const nextAgent = input.agent ?? from.agent;
  if (isOrchestratorThread(from) || binding.sourceType === 'orchestration') {
    assertOrchestratorCapableAgent(nextAgent);
  }

  const thread = createEmptyThread({
    title,
    // Chat-tab nicknames (soccer team or explicit) must stick. Post-turn
    // syncThreadBranchFromGit would otherwise rewrite every sibling to the
    // shared worktree folder name (e.g. fork "Arsenal" → "Monaco").
    userSetTitle: true,
    ...binding,
    agent: nextAgent,
    model:
      input.model !== undefined
        ? input.model
        : input.agent && input.agent !== from.agent
          ? null
          : from.model,
    effort: input.effort !== undefined ? input.effort : from.effort,
    fast: input.fast !== undefined ? Boolean(input.fast) : from.fast,
    planMode: from.planMode,
    autonomy: input.autonomy ?? from.autonomy,
    attachments: input.attachments ?? [],
    status: 'idle',
  });
  writeThread(thread);
  return thread;
}

/** Fork chat into a new tab with transcript attached in the composer.
 * Works for worktree agents and Global orchestration chats (same global home).
 */
export function forkChatTab(input: ForkChatTabInput): Thread {
  const from = requireThread(input.threadId);
  const slice = forkMessageSlice(from, input.throughIndex);
  const attachment = buildForkTranscriptAttachment(from.title || 'Chat', slice);

  const tab = createChatTab({
    fromThreadId: input.threadId,
    agent: input.agent ?? from.agent,
    model: input.model,
    title: input.title?.trim() || undefined,
    attachments: [attachment],
  });

  // Orchestration forks: lineage points at the source orchestrator chat.
  // Worktree tabs keep the shared parentThreadId from the worktree binding.
  if (isOrchestratorThread(from) && tab.parentThreadId !== from.id) {
    const next = { ...tab, parentThreadId: from.id };
    writeThread(next);
    return next;
  }
  return tab;
}
