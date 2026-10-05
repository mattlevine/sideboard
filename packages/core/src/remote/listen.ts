import type { AgentKind } from '../types/thread.js';
import { coerceOrchestratorAgent } from '../agents/orchestrator-capable.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { outboundReplyFromTurn } from '../orchestrator/outbound-turn-reply.js';
import { extractPendingPlanQuestions } from '../plan/ask-user.js';
import { resolveOrchestratorDefaults } from '../store/app-settings.js';
import {
  ensureRemoteCoordinator,
  findRemoteCoordinator,
} from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import type { RemoteAskQuestion } from './protocol.js';

export const REMOTE_STOPPED_REPLY = 'Sideboard stopped the in-progress turn.';

export function formatRemotePrompt(text: string): string {
  return `Phone\n\n${text.trim()}`;
}

export function isRemoteStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === 'stop';
}

export type RemoteOutbound =
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: RemoteAskQuestion[] };

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
 * Phone text → Global orchestrator on this Mac → reply or ask_user buttons.
 * Same turn loop as Slack Listen, without Slack.
 */
export function handleRemoteInbound(
  text: string,
  opts: {
    deviceId: string;
    agent?: AgentKind;
    onOutbound: (msg: RemoteOutbound) => void;
    onLog?: (line: string) => void;
  },
): void {
  const generation = ++inboundGeneration;
  const log = opts.onLog ?? (() => undefined);
  enqueue(async () => {
    if (generation !== inboundGeneration) return;
    const agent = coerceOrchestratorAgent(opts.agent ?? resolveOrchestratorDefaults().agent);
    const body = text.trim();
    if (!body) return;
    if (isRemoteStopCommand(body)) {
      const live = findRemoteCoordinator(opts.deviceId);
      if (live) {
        try {
          getOrchestrator().stop(live.id, { clearQueue: true });
        } catch (err) {
          log(`stop: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (generation !== inboundGeneration) return;
      opts.onOutbound({ type: 'assistant', text: REMOTE_STOPPED_REPLY });
      return;
    }

    let thread = ensureRemoteCoordinator(opts.deviceId, agent);
    const fresh = readThread(thread.id) ?? thread;
    if (fresh.status === 'running' || fresh.status === 'queued') {
      try {
        getOrchestrator().stop(fresh.id, { clearQueue: true });
      } catch {
        // the next send still replaces the turn
      }
    }
    if (generation !== inboundGeneration) return;
    const orch = getOrchestrator();
    try {
      await orch.send(thread.id, formatRemotePrompt(body));
      await orch.waitForTurn(thread.id, 14 * 60 * 1000);
    } catch (err) {
      if (generation !== inboundGeneration) return;
      const message = err instanceof Error ? err.message : String(err);
      opts.onOutbound({ type: 'assistant', text: `Sideboard failed: ${message}` });
      return;
    }
    if (generation !== inboundGeneration) return;
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
  });
}
