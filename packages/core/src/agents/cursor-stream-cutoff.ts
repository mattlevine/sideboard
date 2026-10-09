/**
 * Cursor dropped the model stream. Same class as `Connection stalled`.
 * Not a generic 500, "model unavailable", a feature gate, or the user hitting
 * Stop (that is run status `cancelled`, exit 0).
 */
const CURSOR_STREAM_CUTOFF =
  /nghttp2|premature close|\[unavailable\]\s+error\b|http\/2 stream closed|\bcancel \(0x8\)|error code cancel\b/i;

/** Consecutive HTTP/2 drops to auto-resume before the thread parks. */
export const CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT = 3;

export function looksLikeCursorStreamCutOff(text: string): boolean {
  return CURSOR_STREAM_CUTOFF.test(text.trim());
}

/** Non-null when this failure may auto-resume more than once. */
export function cursorStreamCutOffContinueLimit(detail: string): number | null {
  if (looksLikeCursorStreamCutOff(detail) || /connection stalled/i.test(detail)) {
    return CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT;
  }
  return null;
}

/**
 * Next resume count for this thread, or null when the failure should park.
 * Stream cutoffs allow {@link CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT}; other crashes allow one.
 */
export function nextCrashContinueCount(detail: string, used: number): number | null {
  const limit = cursorStreamCutOffContinueLimit(detail) ?? 1;
  if (used >= limit) return null;
  return used + 1;
}
