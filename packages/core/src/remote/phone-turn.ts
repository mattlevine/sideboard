import type { AgentKind } from '../types/thread.js';
import { coerceOrchestratorAgent } from '../agents/orchestrator-capable.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { outboundReplyFromTurn } from '../orchestrator/outbound-turn-reply.js';
import { extractPendingPlanQuestions } from '../plan/ask-user.js';
import { followUpBehavior, resolveOrchestratorDefaults } from '../store/app-settings.js';
import { ensureRemoteCoordinator, findRemoteCoordinator } from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import { readPhoneThread } from './phone-chats.js';
import { REMOTE_STOPPED_REPLY, type RemoteOutbound } from './phone-live.js';

export function formatRemotePrompt(text: string): string {
  return `Phone\n\n${text.trim()}`;
}

export function isRemoteStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === 'stop';
}

/** Queue leaves the in-flight turn running instead of steering over it. */
export function phoneFollowUpQueues(status: string | undefined): boolean {
  return followUpBehavior() === 'queue' && (status === 'running' || status === 'queued');
}

const PHONE_TURN_MS = 14 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Steer sets status to stopped while the replacement prompt is still queued.
 * Keep polling that gap. waitForTurn treats stopped as finished.
 */
export async function waitForPhoneTurn(
  threadId: string,
  stillCurrent: () => boolean,
): Promise<void> {
  const deadline = Date.now() + PHONE_TURN_MS;
  while (stillCurrent() && Date.now() < deadline) {
    const thread = readPhoneThread(threadId) ?? readThread(threadId);
    if (!thread) return;
    if (thread.status === 'stopped' && thread.queue.length > 0) {
      await delay(40);
      continue;
    }
    break;
  }
  if (!stillCurrent()) return;
  const thread = readPhoneThread(threadId) ?? readThread(threadId);
  if (!thread || (thread.status !== 'running' && thread.status !== 'queued')) return;
  await getOrchestrator().waitForTurn(threadId, Math.max(1, deadline - Date.now()));
}

let handleChain: Promise<void> = Promise.resolve();
let inboundGeneration = 0;

function enqueue(fn: () => Promise<void>): void {
  const run = handleChain.then(fn, fn);
  handleChain = run.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * `stop` inside the phone handle queue cannot unblock the previous
 * `waitForTurn`. A follow-up prompt steers via `send` instead — force-stop
 * (`clearQueue`) drops that prompt and starts a second Cursor run while the
 * first is still active (`request failed: agent still running`).
 */
export function interruptRemoteCoordinator(
  deviceId: string,
  log: (line: string) => void = () => undefined,
): boolean {
  try {
    const live = findRemoteCoordinator(deviceId);
    if (!live) return false;
    const fresh = readThread(live.id) ?? live;
    if (fresh.status !== 'running' && fresh.status !== 'queued') return false;
    getOrchestrator().stop(fresh.id, { clearQueue: true });
    log(`interrupt phone → coordinator ${fresh.id.slice(0, 8)} (${fresh.status})`);
    return true;
  } catch (err) {
    log(`interrupt: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

type CoordinatorOpts = {
  deviceId: string;
  agent?: AgentKind;
  onOutbound: (msg: RemoteOutbound) => void;
  onLog?: (line: string) => void;
};

function runCoordinatorPrompt(
  opts: CoordinatorOpts,
  body: string,
  generation: number,
): Promise<void> {
  const current = () => generation === inboundGeneration;
  return (async () => {
    if (!current()) return;
    const agent = coerceOrchestratorAgent(opts.agent ?? resolveOrchestratorDefaults().agent);
    if (!body) return;
    if (isRemoteStopCommand(body)) {
      if (!current()) return;
      opts.onOutbound({ type: 'assistant', text: REMOTE_STOPPED_REPLY });
      return;
    }

    let thread = ensureRemoteCoordinator(opts.deviceId, agent);
    thread = readThread(thread.id) ?? thread;
    const followUp = followUpBehavior();
    const orch = getOrchestrator();
    try {
      await orch.send(thread.id, formatRemotePrompt(body), { followUp });
      if (!current()) return;
      await waitForPhoneTurn(thread.id, current);
    } catch (err) {
      if (!current()) return;
      const message = err instanceof Error ? err.message : String(err);
      opts.onOutbound({ type: 'assistant', text: `Sideboard failed: ${message}` });
      return;
    }
    if (!current()) return;
    thread = readThread(thread.id) ?? thread;
    if (thread.status === 'stopped') return;
    const result = orch.getTurnResult(thread.id);
    const pending = extractPendingPlanQuestions(
      [...thread.messages].reverse().find((m) => m.role === 'agent')?.parts,
    );
    if (result.taskState === 'input-required' && pending) {
      opts.onOutbound({
        type: 'ask_user',
        text: result.text.trim(),
        questions: pending.questions.map((q) => ({
          question: q.question,
          options: q.options.map((o) =>
            o.description ? { label: o.label, description: o.description } : { label: o.label },
          ),
        })),
      });
      return;
    }
    const reply = outboundReplyFromTurn(result, {
      inputRequired: 'Sideboard is waiting for an answer.',
      canceled: REMOTE_STOPPED_REPLY,
      completedEmpty: () => '',
      failed: (detail) =>
        detail ? `Sideboard failed: ${detail}` : 'Sideboard failed before producing a result.',
    });
    if (reply.trim()) opts.onOutbound({ type: 'assistant', text: reply.trim() });
  })();
}

/** Steer starts immediately. Queue waits so the in-flight reply is not dropped. */
export function beginCoordinatorPrompt(body: string, opts: CoordinatorOpts): void {
  const live = body ? findRemoteCoordinator(opts.deviceId) : null;
  const fresh = live ? (readThread(live.id) ?? live) : null;
  if (body && !isRemoteStopCommand(body) && phoneFollowUpQueues(fresh?.status)) {
    const generation = inboundGeneration;
    enqueue(() => runCoordinatorPrompt(opts, body, generation));
    return;
  }
  const generation = ++inboundGeneration;
  if (body && isRemoteStopCommand(body)) {
    interruptRemoteCoordinator(opts.deviceId, opts.onLog ?? (() => undefined));
  }
  const task = runCoordinatorPrompt(opts, body, generation);
  enqueue(() => task);
}
