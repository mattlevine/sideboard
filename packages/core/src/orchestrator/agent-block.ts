import { denyPendingToolPermissions } from '../agents/tool-permission.js';
import { isDismissedAskUserBlock } from '../board/agent-block-view.js';
import {
  extractPendingPlanQuestions,
  isAskUserToolName,
  parsePlanQuestionsInput,
  planQuestionsSignature,
} from '../plan/ask-user.js';
import { extractPresentedPlan, isPresentPlanToolName } from '../plan/plan-present.js';
import { readThread, updateThread } from '../store/thread-store.js';
import type { AgentBlock, AgentBlockSource } from '../types/agent-block.js';
import type { MessagePart } from '../types/thread.js';
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
    return {
      ...makeAgentBlock('ask_user', reason, at),
      onScreen: true,
      ...(pending
        ? { questionSignature: pending.signature, questions: pending.questions }
        : {}),
    };
  }
  if (!planMode || last?.type !== 'tool') return null;
  const exited = /exitplanmode/i.test(last.name ?? '');
  if (!isPresentPlanToolName(last.name) && !exited) return null;
  const presented = extractPresentedPlan(parts);
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
 * A transcript ask_user with empty input still replaces the stamp. Keep the
 * questions captured when the tool was called so the chat picker can render.
 */
function withStampedQuestions(
  decision: AgentBlock,
  existing: AgentBlock | null | undefined,
): AgentBlock {
  if (decision.source !== 'ask_user' || decision.questions?.length) return decision;
  if (existing?.source !== 'ask_user' || !existing.questions?.length) return decision;
  return {
    ...decision,
    questions: existing.questions,
    questionSignature: decision.questionSignature ?? existing.questionSignature,
  };
}

/**
 * Turn-end block. Errors clear it. A successful or stopped turn keeps a
 * decision in the transcript, or a block stamped earlier in this turn
 * when that tool never showed up in the transcript. A later top-level tool
 * means an ask_user / plan stamp is stale. A skipped question stays down.
 * Reported blocks stay until the next user message.
 */
export function agentBlockAfterTurn(input: {
  existing: AgentBlock | null | undefined;
  parts: MessagePart[] | undefined;
  planMode: boolean;
  failed: boolean;
  dismissedQuestionSignature?: string | null;
}): AgentBlock | null {
  if (input.failed) return null;
  const decision = decisionBlockFromParts(input.parts, input.planMode);
  if (decision) {
    const next = withStampedQuestions(decision, input.existing);
    if (isDismissedAskUserBlock(next, input.dismissedQuestionSignature)) {
      return input.existing?.source === 'reported' ? input.existing : null;
    }
    return next;
  }
  if (
    input.existing &&
    input.existing.source !== 'reported' &&
    lastTopLevelTool(input.parts)
  ) {
    return null;
  }
  if (isDismissedAskUserBlock(input.existing, input.dismissedQuestionSignature)) return null;
  return input.existing ?? null;
}

export function clearAgentBlock(threadId: string): void {
  const thread = readThread(threadId);
  if (!thread?.agentBlock && !thread?.dismissedQuestionSignature) return;
  updateThread(threadId, { agentBlock: null, dismissedQuestionSignature: null });
}

/**
 * The question UI for this signature is no longer active (skipped, or the
 * user sent their own message instead). Drop the sidebar / board ask
 * highlight so it does not stick around after they choose not to answer.
 * Plan, permission, and reported highlights stay.
 */
export function dismissAskUserQuestion(threadId: string, signature: string): void {
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return;
  const sig = signature.trim();
  if (!sig) return;
  const clearBlock = thread.agentBlock?.source === 'ask_user';
  if (thread.dismissedQuestionSignature === sig && !clearBlock) return;
  updateThread(threadId, {
    dismissedQuestionSignature: sig,
    ...(clearBlock ? { agentBlock: null } : {}),
  });
}

function askBlocksEqual(
  a: AgentBlock | null | undefined,
  b: AgentBlock | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source === b.source &&
    a.reason === b.reason &&
    a.at === b.at &&
    a.onScreen === b.onScreen &&
    a.questionSignature === b.questionSignature
  );
}

/**
 * Live-stream counterpart to settle. Mark an ask_user block on-screen once
 * that tool is the last top-level action; drop it when a later tool runs.
 */
export function askBlockAfterLiveParts(
  existing: AgentBlock | null | undefined,
  parts: MessagePart[] | undefined,
): AgentBlock | null {
  const last = lastTopLevelTool(parts);
  if (last?.type === 'tool' && isAskUserToolName(last.name)) {
    if (existing?.source === 'ask_user' && existing.onScreen) return existing;
    const pending = extractPendingPlanQuestions(parts);
    const questions = pending?.questions ?? existing?.questions;
    if (!questions?.length) {
      return existing?.source === 'ask_user'
        ? { ...existing, onScreen: true }
        : existing ?? null;
    }
    const at = existing?.source === 'ask_user' ? existing.at : undefined;
    return {
      ...makeAgentBlock('ask_user', formatAskUserNotifyMessage(questions), at),
      onScreen: true,
      questionSignature:
        pending?.signature ?? existing?.questionSignature,
      questions,
    };
  }
  if (last && existing?.source === 'ask_user') return null;
  return existing ?? null;
}

export function syncAskUserBlockFromLive(
  threadId: string,
  parts: MessagePart[] | undefined,
): void {
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return;
  const next = askBlockAfterLiveParts(thread.agentBlock, parts);
  if (askBlocksEqual(thread.agentBlock, next)) return;
  updateThread(threadId, { agentBlock: next });
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
  denyPendingToolPermissions(threadId);
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return;
  const next = agentBlockAfterTurn({
    existing: thread.agentBlock,
    parts,
    planMode: Boolean(thread.planMode),
    failed,
    dismissedQuestionSignature: thread.dismissedQuestionSignature,
  });
  const prev = thread.agentBlock ?? null;
  if (prev === next) return;
  if (
    prev &&
    next &&
    prev.source === next.source &&
    prev.reason === next.reason &&
    prev.at === next.at &&
    prev.questionSignature === next.questionSignature &&
    planQuestionsSignature(prev.questions ?? []) ===
      planQuestionsSignature(next.questions ?? [])
  ) {
    return;
  }
  updateThread(threadId, { agentBlock: next });
}

export function chatBlockedSuffix(thread: { agentBlock?: { reason?: string } | null }): string {
  const raw = thread.agentBlock?.reason;
  if (!raw?.trim()) return '';
  return `  blocked:${raw.replace(/\s+/g, ' ').slice(0, 80)}`;
}

export function agentBlockFields(thread: {
  agentBlock?: { reason?: string; source?: AgentBlockSource } | null;
}): { blockedReason: string | null; blockedSource: AgentBlockSource | null } {
  return {
    blockedReason: thread.agentBlock?.reason ?? null,
    blockedSource: thread.agentBlock?.source ?? null,
  };
}

export function stampAskUserBlock(
  resolveCaller: () => { id: string },
  questions: Array<{ question?: string }>,
): string {
  const asked = formatAskUserNotifyMessage(questions);
  const parsed = parsePlanQuestionsInput({ questions });
  const block = makeAgentBlock('ask_user', asked);
  try {
    writeAgentBlock(
      resolveCaller().id,
      parsed.length
        ? {
            ...block,
            questionSignature: planQuestionsSignature(parsed),
            questions: parsed,
          }
        : block,
    );
  } catch {
    /* no thread — picker still returns */
  }
  return asked;
}

export function stampPlanBlock(threadId: string | undefined, title: string | undefined): string {
  const planTitle = title?.trim() || 'Plan';
  if (threadId) {
    const reason = planTitle === 'Plan' ? 'Waiting for plan approval' : `Waiting for plan approval: ${planTitle}`;
    writeAgentBlock(threadId, makeAgentBlock('plan', reason));
  }
  return planTitle;
}

export function stampNotifyBlock(
  threadId: string,
  reason: 'input-required' | 'blocked' | undefined,
  message: string,
): 'input-required' | 'blocked' {
  const resolved = reason ?? 'blocked';
  writeAgentBlock(threadId, makeAgentBlock(resolved === 'input-required' ? 'ask_user' : 'reported', message));
  return resolved;
}
