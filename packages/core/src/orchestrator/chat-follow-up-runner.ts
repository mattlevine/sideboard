import { getPrCiChecks, resolvePrSelector } from '../git/worktree.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import { listThreads, readThread, updateThread } from '../store/thread-store.js';
import {
  ciChecksSettled,
  decideFollowUps,
  mergeFollowUpPoll,
  normalizeChatFollowUps,
  type CiPhase,
  type ChatFollowUp,
} from '../threads/chat-follow-ups.js';
import type { Thread } from '../types/thread.js';

const POLL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

async function ciPhase(thread: Thread): Promise<CiPhase> {
  const selector = resolvePrSelector(thread);
  if (!selector || !thread.worktreePath?.trim()) return 'none';
  try {
    const checks = await getPrCiChecks(thread.worktreePath, selector);
    return ciChecksSettled(checks);
  } catch {
    return 'unknown';
  }
}

/** Send due follow-ups. A running turn keeps going; the prompt waits behind it. */
export async function pollChatFollowUps(
  send: (id: string, prompt: string) => Promise<unknown> = defaultSend,
): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const threads = listThreads().filter(
      (thread) =>
        thread.status !== 'archived' && (thread.followUps?.length ?? 0) > 0,
    );
    for (const thread of threads) {
      const followUps = thread.followUps ?? [];
      const ci = followUps.some((item) => item.kind === 'ci')
        ? await ciPhase(thread)
        : 'none';
      const decision = decideFollowUps({ followUps, now: new Date(), ci });
      const kept: ChatFollowUp[] = [...decision.keep];
      const firedIds: string[] = [];
      for (const item of decision.fire) {
        try {
          await send(thread.id, `[Follow-up]\n${item.prompt}`);
          firedIds.push(item.id);
        } catch {
          kept.push(item);
        }
      }
      const fresh = readThread(thread.id);
      if (!fresh || fresh.status === 'archived') continue;
      const after = normalizeChatFollowUps(fresh.followUps);
      const next = mergeFollowUpPoll({
        before: followUps,
        after,
        firedIds,
        keep: kept,
      });
      if (JSON.stringify(next) !== JSON.stringify(after)) {
        updateThread(thread.id, { followUps: next });
      }
    }
  } finally {
    polling = false;
  }
}

async function defaultSend(id: string, prompt: string): Promise<void> {
  const { getOrchestrator } = await import('./orchestrator.js');
  await getOrchestrator().send(id, prompt, { followUp: 'join' });
}

/** Desktop host polls every minute. MCP and CLI persist the follow-up and do not poll. */
export function armChatFollowUps(): void {
  if (!isThisProcessDesktopHost()) return;
  if (timer) return;
  const tick = (): void => {
    timer = setTimeout(() => {
      void pollChatFollowUps().finally(tick);
    }, POLL_MS);
  };
  void pollChatFollowUps();
  tick();
}

export function clearChatFollowUpTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
