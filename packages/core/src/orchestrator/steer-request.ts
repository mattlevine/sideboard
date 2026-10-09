import { randomUUID } from 'node:crypto';
import { readThread, updateThread } from '../store/thread-store.js';
import type { SteerRequest } from '../types/thread.js';

export function isUnclaimedSteerRequest(req: SteerRequest | null | undefined): boolean {
  return Boolean(req?.requestId && !req.claimedAt);
}

/** Keep an in-flight handoff; otherwise mint a new one. */
export function nextSteerRequest(existing: SteerRequest | null | undefined): SteerRequest {
  if (existing?.requestId && !existing.claimedAt) return existing;
  return { requestId: randomUUID(), requestedAt: new Date().toISOString() };
}

export function claimSteerRequest(threadId: string): void {
  const pending = readThread(threadId)?.steerRequest;
  if (!pending?.requestId || pending.claimedAt) return;
  updateThread(threadId, {
    steerRequest: { ...pending, claimedAt: new Date().toISOString() },
  });
}
