import { extractPendingPlanQuestions, isAskUserToolName } from '../plan/ask-user.js';
import { extractPresentedPlan } from '../plan/plan-present.js';
import { readThread, updateThread } from '../store/thread-store.js';
import type { AgentBlock, AgentBlockSource, MessagePart } from '../types/thread.js';
import { formatAskUserNotifyMessage } from './notify-orchestrator.js';

/** Sidebar / orchestrator reasons stay one line. */
export const MAX_AGENT_BLOCK_REASON = 240;

export function clampBlockReason(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return 'Waiting on a decision';
  if (text.length <= MAX_AGENT_BLOCK_REASON) return text;
  return `${text.slice(0, MAX_AGENT_BLOCK_REASON - 1)}…`;
}

export function makeAgentBlock(
  source: AgentBlockSource,
  reason: string,
  at = new Date().toISOString(),
): AgentBlock {
  return { source, reason: clampBlockReason(reason), at };
}

function lastTopLevelTool(parts: MessagePart[] | undefined): MessagePart | null {
  if (!parts?.length) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.type === 'tool' && !part.parentId) return part;
  }
  return null;
}

/**
 * Decision UI in a finished turn. Ask-user wins over plan approval.
 * A long plan write-up with no present_plan / ExitPlanMode is not blocked.
 */
export function decisionBlockFromParts(
  parts: MessagePart[] | undefined,
  planMode: boolean,
  at = new Date().toISOString(),
): AgentBlock | null {
  const last = lastTopLevelTool(parts);
  if (last?.type === 'tool' && isAskUserToolName(last.name)) {
    const pending = extractPendingPlanQuestions(parts);
    const reason = pending
      ? formatAskUserNotifyMessage(pending.questions)
      : 'Waiting for an answer in that chat.';
    return makeAgentBlock('ask_user', reason, at);
  }
  if (!planMode || !parts?.length) return null;
  const presented = extractPresentedPlan(parts);
  const exited = parts.some(
    (part) =>
      part.type === 'tool' &&
      !part.parentId &&
      /exitplanmode/i.test(part.name ?? ''),
  );
  if (!presented && !exited) return null;
  const title =
    presented?.title && presented.title !== 'Plan' ? presented.title : '';
  return makeAgentBlock(
    'plan',
    title ? `Waiting for plan approval: ${title}` : 'Waiting for plan approval',
    at,
  );
}

/**
 * Turn-end block. Errors clear it. A successful or stopped turn keeps a
 * decision in the transcript, or a block stamped earlier in this turn
 * (notify_orchestrator / ask_user / present_plan) when the transcript
 * did not echo the tool.
 */
export function agentBlockAfterTurn(input: {
  existing: AgentBlock | null | undefined;
  parts: MessagePart[] | undefined;
  planMode: boolean;
  failed: boolean;
}): AgentBlock | null {
  if (input.failed) return null;
  const decision = decisionBlockFromParts(input.parts, input.planMode);
  if (decision) return decision;
  return input.existing ?? null;
}

export function clearAgentBlock(threadId: string): void {
  const thread = readThread(threadId);
  if (!thread?.agentBlock) return;
  updateThread(threadId, { agentBlock: null });
}

export function writeAgentBlock(threadId: string, block: AgentBlock): void {
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return;
  updateThread(threadId, { agentBlock: block });
}

export function settleAgentBlock(
  threadId: string,
  parts: MessagePart[] | undefined,
  failed: boolean,
): void {
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return;
  const next = agentBlockAfterTurn({
    existing: thread.agentBlock,
    parts,
    planMode: Boolean(thread.planMode),
    failed,
  });
  const prev = thread.agentBlock ?? null;
  if (prev === next) return;
  if (
    prev &&
    next &&
    prev.source === next.source &&
    prev.reason === next.reason &&
    prev.at === next.at
  ) {
    return;
  }
  updateThread(threadId, { agentBlock: next });
}
