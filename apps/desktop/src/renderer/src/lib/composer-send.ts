import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ThreadAttachment } from '@sideboard-ai/core';
import {
  joinSteerPrompt,
  type OptimisticUserSend,
  type PendingFollowUp,
} from './visible-follow-up-queue';

type FollowUp = 'steer' | 'queue';

type SendGate = {
  tryBegin(): boolean;
  end(): void;
};

export type ComposerSendInput = {
  dictationStop: () => Promise<string | null | undefined>;
  promptRef: MutableRefObject<string>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setCursor: (cursor: number) => void;
  followUpBehavior: FollowUp;
  agentReplying: boolean;
  openPromptRef: MutableRefObject<string | null>;
  setOptimisticUsers: Dispatch<SetStateAction<OptimisticUserSend[]>>;
  messages: Array<{ role: string; text?: string; origin?: string }>;
  setPendingUser: (text: string | null) => void;
  setPendingInTranscript: (pending: boolean) => void;
  followUpBusy: boolean;
  busy: boolean;
  sendGate: SendGate;
  pendingInTranscript: boolean;
  pendingUser: string | null;
  steeringFollowUp: boolean;
  confirmSendDespiteClaudeUsage: () => Promise<boolean>;
  attachments: ThreadAttachment[] | undefined;
  threadId: string;
  pendingPlanQuestions: { signature: string } | null;
  setDismissedPlanQuestionsId: (signature: string) => void;
  setPendingAttachments: Dispatch<SetStateAction<ThreadAttachment[]>>;
  setPendingFollowUps: Dispatch<SetStateAction<PendingFollowUp[]>>;
  suppressArtifactAutoOpen: MutableRefObject<boolean>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  onRefresh: () => void;
  clearPendingSend: () => void;
  pendingSendsRef: MutableRefObject<string[]>;
};

function rememberOptimistic(input: ComposerSendInput, text: string) {
  if (input.followUpBehavior === 'steer' && !input.agentReplying && input.openPromptRef.current != null) {
    const combined = joinSteerPrompt(input.openPromptRef.current, text);
    input.openPromptRef.current = combined;
    input.setOptimisticUsers((prev) => {
      if (prev.length === 0) return [{ text: combined, seen: 0 }];
      const next = prev.slice();
      const last = next[next.length - 1]!;
      next[next.length - 1] = { ...last, text: combined };
      return next;
    });
    input.setPendingUser(combined);
    input.setPendingInTranscript(true);
    return;
  }
  const seen = input.messages.reduce(
    (count, message) =>
      count +
      (message.role === 'user' && message.origin !== 'continue' && message.text === text ? 1 : 0),
    0,
  );
  if (input.followUpBehavior === 'steer' && !input.agentReplying) input.openPromptRef.current = text;
  input.setOptimisticUsers((prev) => [...prev, { text, seen }]);
}

function forgetOptimistic(input: ComposerSendInput, text: string) {
  let restored: string | null = null;
  let clearOpen = false;
  input.setOptimisticUsers((prev) => {
    const last = prev[prev.length - 1];
    if (last?.text === text) {
      clearOpen = input.openPromptRef.current === text;
      return prev.slice(0, -1);
    }
    const suffix = `\n${text}`;
    if (last?.text.endsWith(suffix)) {
      restored = last.text.slice(0, -suffix.length);
      const next = prev.slice();
      next[next.length - 1] = { ...last, text: restored };
      return next;
    }
    const idx = prev.map((item) => item.text).lastIndexOf(text);
    if (idx < 0) return prev;
    return prev.filter((_, i) => i !== idx);
  });
  if (clearOpen) input.openPromptRef.current = null;
  if (restored != null) {
    input.openPromptRef.current = restored;
    input.setPendingUser(restored);
  }
}

function clearComposerIfUnchanged(input: ComposerSendInput, sent: string) {
  if (input.promptRef.current.trim() !== sent) return;
  input.setPrompt('');
  input.setCursor(0);
}

function restoreComposerIfEmpty(input: ComposerSendInput, text: string) {
  input.setPrompt((current) => (current.trim() ? current : text));
}

function beginPendingSend(input: ComposerSendInput, text: string, attachments: ThreadAttachment[] = []) {
  if (input.pendingPlanQuestions) input.setDismissedPlanQuestionsId(input.pendingPlanQuestions.signature);
  if (
    input.followUpBehavior === 'steer' &&
    !input.agentReplying &&
    input.openPromptRef.current &&
    input.openPromptRef.current !== text
  ) {
    if (attachments.length > 0) input.setPendingAttachments(attachments);
    return;
  }
  // A second send before the agent replies must not replace the first bubble.
  const preserveInFlight =
    input.pendingInTranscript && input.pendingUser != null && input.pendingUser !== text && !input.agentReplying;
  const queueing = (input.followUpBusy && !input.steeringFollowUp) || preserveInFlight;
  if (queueing) {
    input.setPendingFollowUps((prev) => [...prev, { id: crypto.randomUUID(), text }]);
    return;
  }
  input.setPendingUser(text);
  input.setPendingInTranscript(true);
  input.setPendingAttachments(attachments);
}

async function deliverSend(input: ComposerSendInput, text: string): Promise<'ok' | 'cancel' | 'error'> {
  const preserveInFlight =
    input.pendingInTranscript &&
    input.pendingUser != null &&
    input.pendingUser !== text &&
    !input.agentReplying;
  const queueing = (input.followUpBusy && !input.steeringFollowUp) || preserveInFlight;
  if (!(await input.confirmSendDespiteClaudeUsage())) {
    forgetOptimistic(input, text);
    restoreComposerIfEmpty(input, text);
    return 'cancel';
  }
  const snapshotAttachments = [...(input.attachments ?? [])];
  beginPendingSend(input, text, snapshotAttachments);
  clearComposerIfUnchanged(input, text);
  input.suppressArtifactAutoOpen.current = false;
  if (!input.followUpBusy) input.setBusy(true);
  try {
    await window.sideboard.sendToThread(input.threadId, text);
    input.onRefresh();
    return 'ok';
  } catch (err) {
    if (queueing) {
      input.setPendingFollowUps((prev) => {
        const idx = [...prev].reverse().findIndex((p) => p.text === text);
        if (idx < 0) return prev;
        const i = prev.length - 1 - idx;
        return prev.filter((_, j) => j !== i);
      });
    } else {
      input.clearPendingSend();
    }
    forgetOptimistic(input, text);
    restoreComposerIfEmpty(input, text);
    window.alert(err instanceof Error ? err.message : String(err));
    return 'error';
  } finally {
    if (!input.followUpBusy) input.setBusy(false);
  }
}

function dropQueuedSends(input: ComposerSendInput) {
  for (const extra of input.pendingSendsRef.current.splice(0).reverse()) forgetOptimistic(input, extra);
}

async function flushPendingSends(input: ComposerSendInput) {
  if (input.pendingSendsRef.current.length === 0) return;
  if (!input.sendGate.tryBegin()) return;
  try {
    while (input.pendingSendsRef.current.length > 0) {
      const next = input.pendingSendsRef.current.shift()!;
      const result = await deliverSend(input, next);
      if (result === 'cancel') {
        dropQueuedSends(input);
        break;
      }
      if (result === 'error') break;
    }
  } finally {
    input.sendGate.end();
    if (input.pendingSendsRef.current.length > 0) void flushPendingSends(input);
  }
}

/** Plan-question reply. Shows the pending bubble, then sends that text as-is. */
export async function submitPlanAnswer(input: ComposerSendInput, message: string): Promise<void> {
  if (!input.sendGate.tryBegin()) return;
  try {
    if (!(await input.confirmSendDespiteClaudeUsage())) return;
    input.setBusy(true);
    beginPendingSend(input, message);
    try {
      await window.sideboard.sendToThread(input.threadId, message);
      input.setPrompt('');
      input.onRefresh();
    } catch (err) {
      input.clearPendingSend();
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      input.setBusy(false);
    }
  } finally {
    input.sendGate.end();
  }
}

/** Send the composer text, joining an early steer onto the prompt still in flight. */
export async function runComposerSend(input: ComposerSendInput): Promise<void> {
  const dictated = await input.dictationStop();
  const text = (dictated ?? input.promptRef.current).trim();
  if (!text) return;
  rememberOptimistic(input, text);
  clearComposerIfUnchanged(input, text);
  // A second Enter while the first IPC or usage confirm is in flight used to
  // return here, then the first send cleared the composer and the text was gone.
  if ((!input.followUpBusy && input.busy) || !input.sendGate.tryBegin()) {
    input.pendingSendsRef.current.push(text);
    return;
  }
  try {
    const result = await deliverSend(input, text);
    if (result === 'cancel') {
      dropQueuedSends(input);
      return;
    }
    if (result === 'error') return;
    while (input.pendingSendsRef.current.length > 0) {
      const next = input.pendingSendsRef.current.shift()!;
      const nextResult = await deliverSend(input, next);
      if (nextResult === 'cancel') {
        dropQueuedSends(input);
        break;
      }
      if (nextResult === 'error') break;
    }
  } finally {
    input.sendGate.end();
    if (input.pendingSendsRef.current.length > 0) void flushPendingSends(input);
  }
}
