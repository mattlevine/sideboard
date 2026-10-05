import type { MessagePart } from '../types/thread.js';
import { messagePartParentId } from './message-parts.js';

/**
 * Claude streams answer tokens, then sends the same prose again as a full
 * assistant snapshot and as the final result. A short delta is not a replay:
 * treating "ends with this token" as a duplicate eats repeated letters
 * ("letter" → "leter").
 */
const REPLAY_MIN_CHARS = 80;

/** Raw text already painted for this stream (top-level or one nested tool). */
export function textSoFar(parts: readonly MessagePart[], parentId?: string): string {
  const parent = parentId?.trim() || '';
  let out = '';
  for (const part of parts) {
    if (part.type !== 'text') continue;
    if ((messagePartParentId(part) ?? '') !== parent) continue;
    out += part.text;
  }
  return out;
}

function replaySized(text: string): boolean {
  return text.trim().length >= REPLAY_MIN_CHARS;
}

/**
 * Text in `incoming` that follows a leading copy of `accumulated`.
 * Null when `incoming` does not start with that answer.
 */
function tailAfterAccumulated(accumulated: string, incoming: string): string | null {
  if (incoming.startsWith(accumulated)) return incoming.slice(accumulated.length);
  const acc = accumulated.trim();
  const inc = incoming.trim();
  if (!acc || !inc.startsWith(acc)) return null;
  const at = incoming.indexOf(acc);
  if (at < 0) return null;
  return incoming.slice(at + acc.length);
}

/**
 * Returns the stdout to append, or null when this chunk is already on screen.
 * A longer snapshot keeps only the unseen tail, and a snapshot that repeats
 * the answer (`text + text`) does not paint the first copy again.
 */
export function foldDuplicateStdout(accumulated: string, incoming: string): string | null {
  if (!incoming) return null;
  if (!accumulated) return incoming;

  const accTrim = accumulated.trim();
  const incTrim = incoming.trim();
  if (!incTrim) return incoming;
  if (incTrim === accTrim) return null;
  if (!replaySized(incoming)) return incoming;
  if (accTrim.includes(incTrim)) return null;

  let tail = tailAfterAccumulated(accumulated, incoming);
  if (tail == null) return incoming;

  for (let i = 0; i < 3 && tail.trim(); i++) {
    const next = tailAfterAccumulated(accumulated, tail);
    if (next == null) break;
    tail = next;
  }
  return tail.trim() ? tail : null;
}
