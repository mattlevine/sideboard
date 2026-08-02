import { randomUUID } from 'node:crypto';
import { formatMessagesAsTranscript } from '../composer/context-compact.js';
import { allocateTeamName, teamSlugFromName } from '../git/teams.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
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
    sourceType: from.sourceType === 'orchestration' ? 'branch' : from.sourceType,
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

  const siblings = threadsSharingWorktree(binding.worktreePath);
  const explicitTitle = input.title?.trim();
  const title =
    explicitTitle ||
    allocateTeamName(
      siblings
        .map((t) => teamSlugFromName(t.title))
        .filter((slug): slug is string => Boolean(slug)),
    ).name;

  const thread = createEmptyThread({
    title,
    userSetTitle: Boolean(explicitTitle),
    ...binding,
    agent: input.agent ?? from.agent,
    model: input.agent && input.agent !== from.agent ? null : from.model,
    fast: from.fast,
    planMode: from.planMode,
    autonomy: from.autonomy,
    attachments: input.attachments ?? [],
    status: 'idle',
  });
  writeThread(thread);
  return thread;
}

/** Fork chat into a new tab with transcript attached in the composer. */
export function forkChatTab(input: ForkChatTabInput): Thread {
  const from = requireThread(input.threadId);
  const slice = forkMessageSlice(from, input.throughIndex);
  const attachment = buildForkTranscriptAttachment(from.title || 'Chat', slice);

  return createChatTab({
    fromThreadId: input.threadId,
    agent: input.agent ?? from.agent,
    title: input.title?.trim() || undefined,
    attachments: [attachment],
  });
}
