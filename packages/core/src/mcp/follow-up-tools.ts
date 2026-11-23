import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getPrCiChecks, resolvePrSelector } from '../git/worktree.js';
import { mcpJson } from './issue-list.js';
import { SIDEBOARD_THREAD_ID_ENV } from './profile.js';
import { findThreadByRef, updateThread } from '../store/thread-store.js';
import {
  addChatFollowUp,
  ciChecksSettled,
  normalizeChatFollowUps,
  type CiPhase,
} from '../threads/chat-follow-ups.js';

function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

function callerThread() {
  const id = process.env[SIDEBOARD_THREAD_ID_ENV]?.trim() || '';
  if (!id) return null;
  return findThreadByRef(id);
}

async function baselineCi(thread: NonNullable<ReturnType<typeof callerThread>>): Promise<CiPhase> {
  const selector = resolvePrSelector(thread);
  if (!selector) return 'none';
  try {
    const checks = await getPrCiChecks(thread.worktreePath, selector);
    return ciChecksSettled(checks);
  } catch {
    return 'unknown';
  }
}

export function registerFollowUpTools(server: McpServer): void {
  server.tool(
    'list_follow_ups',
    'List follow-ups on this chat. kind=ci wakes when GitHub checks finish. kind=at wakes at a time. A running turn is not interrupted.',
    {},
    async () => {
      const thread = callerThread();
      if (!thread) return text({ error: 'This chat id is missing' }, true);
      return text({ followUps: normalizeChatFollowUps(thread.followUps) });
    },
  );

  server.tool(
    'create_follow_up',
    'Register a follow-up on THIS chat. kind=ci sends the prompt when GitHub checks on this chat’s PR finish (pass or fail). Checks that are already finished do not send until a later run finishes. A failed checks read does not count as finished or in progress. A CI follow-up that is still pending at deadline (default 7 days) ends silently. kind=at sends at `30m`, `2h`, `1d`, or an ISO time and waits behind a turn that is already running. Cap 10.',
    {
      kind: z.enum(['ci', 'at']),
      prompt: z.string(),
      at: z.string().optional(),
      deadline: z.string().optional(),
    },
    async ({ kind, prompt, at, deadline }) => {
      const thread = callerThread();
      if (!thread) return text({ error: 'This chat id is missing' }, true);
      if (thread.status === 'archived') return text({ error: 'This chat is archived' }, true);
      const existing = normalizeChatFollowUps(thread.followUps);
      const ciBaseline = kind === 'ci' ? await baselineCi(thread) : undefined;
      const added = addChatFollowUp(
        existing,
        { kind, prompt, at, deadline, ciBaseline },
        new Date(),
      );
      if (!added.ok) return text({ error: added.error }, true);
      updateThread(thread.id, { followUps: added.followUps });
      return text({ followUps: added.followUps });
    },
  );

  server.tool(
    'delete_follow_up',
    'Remove one follow-up from this chat by id.',
    { id: z.string() },
    async ({ id }) => {
      const thread = callerThread();
      if (!thread) return text({ error: 'This chat id is missing' }, true);
      const existing = normalizeChatFollowUps(thread.followUps);
      const followUps = existing.filter((item) => item.id !== id.trim());
      if (followUps.length === existing.length) return text({ error: 'Follow-up not found' }, true);
      updateThread(thread.id, { followUps });
      return text({ followUps });
    },
  );
}
