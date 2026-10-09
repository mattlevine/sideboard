import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { workspaceAgentChatSummaries } from '../threads/chat-tabs.js';
import { normalizeWorkspaceTags } from '../git/worktree-labels.js';
import type { AgentKind, ThreadAttachment } from '../types/thread.js';
import {
  orchCreateThreadAgentNote,
  resolveOrchCreateThreadOptions,
  type ResolveNewThreadOptions,
} from './create-thread-agent.js';

const MAX_ORCH_THREADS = 5;
/** Hard ceiling so a stuck create_workspace cannot pin the MCP stdio server forever. */
const CREATE_THREAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type CreateOrchThreadArgs = {
  sourceType: 'branch' | 'pr' | 'ticket';
  sourceRef: string;
  repoPath: string;
  title?: string;
  agent?: AgentKind;
  model?: string | null;
  cowboy?: boolean;
  parentChatId?: string;
  parentThreadId?: string;
  attachments?: ThreadAttachment[];
  tags?: string[] | string;
};

export async function createOrchChildThread(
  orch: ReturnType<typeof getOrchestrator>,
  args: CreateOrchThreadArgs,
  resolveNewThreadOptions: ResolveNewThreadOptions,
): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const envParentId = process.env.SIDEBOARD_ORCHESTRATOR_THREAD_ID?.trim() || '';
  let parentId = args.parentChatId?.trim() || args.parentThreadId?.trim() || '';
  let parent = parentId ? orch.getThread(parentId) : null;
  let parentCorrectedFrom: string | undefined;

  if (envParentId) {
    const envParent = orch.getThread(envParentId);
    if (envParent) {
      if (parentId && parentId !== envParentId) parentCorrectedFrom = parentId;
      else if (!parentId) parentCorrectedFrom = undefined;
      parentId = envParentId;
      parent = envParent;
    }
  }
  if (parentId && !parent) {
    parentCorrectedFrom = parentId;
    parentId = '';
    parent = null;
  }
  if (parentId) {
    const children = orch.getThreads(false).filter((t) => t.parentThreadId === parentId);
    if (children.length >= MAX_ORCH_THREADS) {
      return {
        ok: false,
        text: `Thread-creation cap (${MAX_ORCH_THREADS}) reached for this orchestration session`,
      };
    }
  }
  const opts = resolveOrchCreateThreadOptions({
    requestedAgent: args.agent,
    requestedModel: args.model,
    parentAgent: parent?.agent,
    resolveNewThreadOptions,
  });
  const agentNote = orchCreateThreadAgentNote(opts);
  try {
    const priorIds = new Set(orch.getThreads(false).map((t) => t.id));
    const thread = await withTimeout(
      orch.createThread({
        sourceType: args.sourceType,
        sourceRef: args.sourceRef,
        agent: opts.agent,
        model: opts.model,
        effort: opts.effort,
        fast: opts.fast,
        repoPath: args.repoPath,
        title: args.title,
        parentThreadId: parentId || null,
        cowboy: args.cowboy || undefined,
        attachments: args.attachments,
        tags: args.tags === undefined ? undefined : normalizeWorkspaceTags(args.tags),
      }),
      CREATE_THREAD_TIMEOUT_MS,
      'create_workspace',
    );
    const alreadyStarted = priorIds.has(thread.id);
    const parentNote = parentCorrectedFrom
      ? parentId
        ? `Ignored unknown/stale parentThreadId ${parentCorrectedFrom}; nested under ${parentId}`
        : `Ignored unknown/stale parentThreadId ${parentCorrectedFrom}; created without parent`
      : undefined;
    return {
      ok: true,
      text: JSON.stringify({
        id: thread.id,
        title: thread.title,
        branchName: thread.branchName,
        worktreePath: thread.worktreePath,
        agent: thread.agent,
        model: thread.model,
        status: thread.status,
        cowboy: Boolean(thread.cowboy),
        link: `sideboard://chat/${thread.id}`,
        parentChatId: thread.parentThreadId,
        parentThreadId: thread.parentThreadId,
        tags: thread.tags ?? [],
        chats: workspaceAgentChatSummaries(thread.worktreePath),
        ...(alreadyStarted ? { alreadyStarted: true } : {}),
        ...(opts.coercedFrom ? { agentCoercedFrom: opts.coercedFrom } : {}),
        ...(opts.ignoredAgent ? { agentIgnored: opts.ignoredAgent } : {}),
        ...(agentNote ? { note: agentNote } : {}),
        ...(parentCorrectedFrom ? { parentCorrectedFrom, parentNote } : {}),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: `create_workspace failed: ${message}` };
  }
}
