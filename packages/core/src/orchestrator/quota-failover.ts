import { randomUUID } from 'node:crypto';
import {
  isSessionQuotaLimit,
  parseSessionQuotaResetAt,
  resolveQuotaFallbackAgent,
} from '../agents/session-quota.js';
import {
  orchestrationQuotaFallbackAgent,
  usageOnLimit,
  type UsageOnLimit,
} from '../store/app-settings.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { listThreads, updateThread } from '../store/thread-store.js';
import { createChatTab } from '../threads/chat-tabs.js';
import type { AgentKind, Thread, ThreadAttachment } from '../types/thread.js';

export type QuotaFailoverAction = 'switch_agent' | 'wait_reset' | 'none';

export type QuotaFailoverPlan = {
  action: QuotaFailoverAction;
  reason: string;
  limitText: string;
  fallbackAgent?: AgentKind;
  resumeAt?: Date;
};

/** Decide host action when any chat hits a provider session/usage limit. */
export function planOrchestrationQuotaFailover(
  thread: Thread,
  limitText: string,
  opts?: {
    onLimit?: UsageOnLimit;
    fallbackAgent?: AgentKind | null;
    now?: Date;
  },
): QuotaFailoverPlan | null {
  if (!isSessionQuotaLimit(limitText)) return null;

  const onLimit = opts?.onLimit ?? usageOnLimit();
  const resumeAt = parseSessionQuotaResetAt(limitText, opts?.now);

  if (onLimit === 'keep_going' || onLimit === 'confirm') {
    return {
      action: 'none',
      reason:
        onLimit === 'confirm'
          ? 'Settings: confirm with user; no automatic continue.'
          : 'Settings: keep going; no automatic continue.',
      limitText,
    };
  }

  // Already continued once onto another agent — don't cascade forever.
  if (thread.quotaContinuedFromId) {
    if (onLimit === 'switch_agent' && resumeAt) {
      return {
        action: 'wait_reset',
        reason: 'Already continued once; waiting for quota reset instead.',
        limitText,
        resumeAt,
      };
    }
    return {
      action: 'none',
      reason: 'Already continued once; no further automatic continue.',
      limitText,
    };
  }

  if (onLimit === 'wait_reset') {
    if (!resumeAt) {
      return {
        action: 'none',
        reason: 'wait_reset configured but reset time could not be parsed.',
        limitText,
      };
    }
    return {
      action: 'wait_reset',
      reason: 'Settings: wait for quota reset.',
      limitText,
      resumeAt,
    };
  }

  const preferred = opts?.fallbackAgent ?? orchestrationQuotaFallbackAgent();
  const fallbackAgent = resolveQuotaFallbackAgent(thread.agent, preferred);
  return {
    action: 'switch_agent',
    reason: `Continue on ${fallbackAgent} (Auto) after ${thread.agent} session limit.`,
    limitText,
    fallbackAgent,
  };
}

export function buildQuotaHandoffAttachment(
  from: Thread,
  limitText: string,
  fallbackAgent: AgentKind,
): ThreadAttachment {
  const children = listThreads({ includeArchived: false })
    .filter((t) => t.parentThreadId === from.id && t.status !== 'archived')
    .slice(0, 40)
    .map(
      (t) =>
        `- ${t.title} · ${t.status} · ${t.agent} · sideboard://thread/${t.id}`,
    );

  const recent = from.messages
    .slice(-8)
    .map((m) => {
      const role = m.role === 'user' ? 'User' : m.role === 'agent' ? 'Agent' : 'Summary';
      const text = m.text.trim().replace(/\s+/g, ' ').slice(0, 280);
      return text ? `- ${role}: ${text}` : null;
    })
    .filter(Boolean);

  const orch = isOrchestratorThread(from);
  const instructions = orch
    ? [
        '- Continue fleet orchestration from this handoff.',
        '- Prefer Sideboard MCP (list_board, list_threads, get_thread, send_to_thread, …) for live status.',
        '- Leave model Auto unless there is a specific reason to pin one.',
        `- Do not wait on the limited ${from.agent} account; keep going on ${fallbackAgent}.`,
      ]
    : [
        '- Continue this worktree chat from the handoff.',
        '- Leave model Auto unless there is a specific reason to pin one.',
        `- Do not wait on the limited ${from.agent} account; keep going on ${fallbackAgent}.`,
      ];

  const body = [
    `# ${orch ? 'Orchestration' : 'Chat'} handoff`,
    '',
    `Previous chat: ${from.title} (\`${from.id}\`) on **${from.agent}** hit a session/usage limit.`,
    `Limit: ${limitText.trim()}`,
    `Continuing on **${fallbackAgent}** with Auto model.`,
    '',
    `## Goal`,
    from.sourceRef?.trim() || '(none)',
    '',
    `## Child threads`,
    children.length ? children.join('\n') : '(none listed — call list_threads)',
    '',
    `## Recent turns (truncated)`,
    recent.length ? recent.join('\n') : '(none)',
    '',
    `## Instructions`,
    ...instructions,
  ].join('\n');

  return {
    id: randomUUID(),
    name: orch ? 'Orchestration quota handoff.md' : 'Quota handoff.md',
    kind: 'transcript',
    content: body,
  };
}

export const QUOTA_CONTINUE_PROMPT = (fromAgent: AgentKind, fallback: AgentKind) =>
  [
    `${fromAgent} hit a session/usage limit. Continue this chat on ${fallback} using the attached handoff.`,
    'Proceed with the goal. Leave model Auto unless needed.',
  ].join(' ');

export const QUOTA_RESUME_PROMPT =
  'Session/usage limit window should have reset. Continue this chat from where you left off.';

/**
 * Isolate host quota failover from `runTurn`'s try/catch.
 * A throw from sibling create or `appendMessage` must not emit a second
 * `turn_finished` or `notifyParentOfChildHalt` after a sibling exists.
 * Unknown throws are treated as handled so the parent is not woken.
 */
export async function isolateQuotaFailover(
  run: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await run();
  } catch {
    return true;
  }
}

/** Sibling chat on the fallback agent (same worktree or Global home) with a compact handoff. */
export function createQuotaFailoverChat(
  from: Thread,
  fallbackAgent: AgentKind,
  limitText: string,
): Thread {
  const handoff = buildQuotaHandoffAttachment(from, limitText, fallbackAgent);
  const tab = createChatTab({
    fromThreadId: from.id,
    agent: fallbackAgent,
    model: null,
    attachments: [handoff],
  });
  const patch: Partial<Thread> = {
    quotaContinuedFromId: from.id,
    sourceRef: from.sourceRef,
  };
  if (isOrchestratorThread(from)) {
    patch.parentThreadId = from.id;
    patch.sourceType = 'orchestration';
  }
  return updateThread(tab.id, patch);
}
