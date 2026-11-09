import { isJobContinuePrompt } from '../mcp/wait-for-job.js';
import { orchestratorPromisedLaterReport } from '../orchestrator/deferred-report.js';
import {
  outboundReplyFromTurn,
  type OutboundTurnSnapshot,
} from '../orchestrator/outbound-turn-reply.js';
import { readThread } from '../store/thread-store.js';

export const SLACK_LISTEN_STOPPED_REPLY =
  'Sideboard stopped the in-progress turn. Send another message when you want to continue.';

export const SLACK_LISTEN_TIMEOUT_REPLY = [
  'Sideboard timed out waiting for the local agent turn to finish.',
  'Send another message to interrupt and retry, or send "stop".',
].join(' ');

/**
 * Coordinator ended on ask_user. The picker is on this Mac — posting that
 * prompt as the Slack answer looks like the turn finished.
 */
export const SLACK_LISTEN_INPUT_REQUIRED_REPLY = [
  'Sideboard is waiting for an answer on the Mac (the coordinator called ask_user).',
  'The picker is in the Sideboard app — not in Slack.',
  'Reply here after you answer it on the Mac, or send "stop".',
].join(' ');

/**
 * A farewell ("I'll get back to you") is not the Slack answer when Sideboard
 * already queued a continue, or the coordinator is still turning. Hold the
 * post until that follow-up finishes.
 */
export function slackShouldHoldDeferredReply(opts: {
  reply: string;
  queue: readonly string[];
  status: string;
}): boolean {
  if (!orchestratorPromisedLaterReport(opts.reply)) return false;
  if (opts.queue.some((item) => isJobContinuePrompt(item))) return true;
  return opts.status === 'running' || opts.status === 'queued';
}

const SLACK_DEFERRED_HOLD_LIMIT = 3;

async function waitUntilOrchestratorContinueSettles(
  orch: { waitForTurn: (threadId: string, timeoutMs: number) => Promise<unknown> },
  threadId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const thread = readThread(threadId);
    if (!thread || thread.status === 'stopped' || thread.status === 'archived') return;
    if (thread.status === 'running' || thread.status === 'queued') {
      const remaining = Math.max(1, timeoutMs - (Date.now() - start));
      await orch.waitForTurn(threadId, remaining);
      return;
    }
    if (!thread.queue.some((item) => isJobContinuePrompt(item))) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('wait_for_turn timed out');
}

/**
 * Slack inbound already waited out the first turn. If that reply only promised
 * a later update, wait through the host continue so the posted message is the
 * outcome.
 */
export async function awaitDeferredOrchestratorReply(
  orch: {
    waitForTurn: (threadId: string, timeoutMs: number) => Promise<unknown>;
    getTurnResult: (threadId: string) => OutboundTurnSnapshot;
  },
  threadId: string,
  initial: string,
  timeoutMs: number,
  aborted?: () => boolean,
): Promise<{ reply: string; interrupted: boolean }> {
  let reply = initial;
  const deadline = Date.now() + timeoutMs;
  for (let i = 0; i < SLACK_DEFERRED_HOLD_LIMIT; i++) {
    if (aborted?.()) return { reply: '', interrupted: true };
    const thread = readThread(threadId);
    if (!thread || thread.status === 'stopped' || thread.status === 'archived') {
      return { reply: '', interrupted: true };
    }
    if (!slackShouldHoldDeferredReply({ reply, queue: thread.queue, status: thread.status })) {
      return { reply, interrupted: false };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { reply, interrupted: false };
    await waitUntilOrchestratorContinueSettles(orch, threadId, remaining);
    const latest = readThread(threadId);
    if (!latest || latest.status === 'stopped' || latest.status === 'archived') {
      return { reply: '', interrupted: true };
    }
    reply = formatSlackTurnReply(orch.getTurnResult(threadId));
  }
  return { reply, interrupted: false };
}

export function formatSlackTurnReply(result: OutboundTurnSnapshot): string {
  return outboundReplyFromTurn(result, {
    inputRequired: SLACK_LISTEN_INPUT_REQUIRED_REPLY,
    canceled: SLACK_LISTEN_STOPPED_REPLY,
    completedEmpty: () => '',
    failed: (detail) =>
      detail
        ? `Sideboard coordinator failed: ${detail}`
        : 'Sideboard coordinator failed before producing a result.',
  });
}
