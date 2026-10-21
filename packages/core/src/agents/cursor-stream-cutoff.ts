/**
 * Cursor dropped the model stream. Same class as `Connection stalled`.
 * Not a generic 500, "model unavailable", a feature gate, or the user hitting
 * Stop (that is run status `cancelled`, exit 0).
 */
const CURSOR_STREAM_CUTOFF =
  /nghttp2|premature close|\[unavailable\]\s+error\b|http\/2 stream closed|\bcancel \(0x8\)|error code cancel\b/i;

/** Grok (and similar) can go quiet after a tool result; the SDK never closes. */
const CURSOR_STREAM_IDLE_AFTER_TOOLS = /stopped responding after a tool call/i;

/** Consecutive HTTP/2 drops to auto-resume before the thread parks. */
export const CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT = 3;

export function looksLikeCursorStreamCutOff(text: string): boolean {
  return CURSOR_STREAM_CUTOFF.test(text.trim());
}

/**
 * Stream went idle after a completed tool with no follow-up assistant text.
 * Not a user Stop. Resume once (not {@link CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT}).
 */
export function looksLikeCursorStreamIdleAfterTools(text: string): boolean {
  return CURSOR_STREAM_IDLE_AFTER_TOOLS.test(text.trim());
}

/** HTTP/2 cutoff or idle after a tool — retryable, not a user Stop. */
export function looksLikeCursorStreamFailure(text: string): boolean {
  return looksLikeCursorStreamCutOff(text) || looksLikeCursorStreamIdleAfterTools(text);
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

/** Catalog id `grok-4.7` → `Grok 4.7`. Auto/default omitted. */
export function cursorModelDisplayName(model?: string | null): string {
  const raw = (model ?? '').trim();
  if (!raw || /^(auto|default)$/i.test(raw)) return '';
  if (/^grok-/i.test(raw)) return raw.replace(/^grok-/i, 'Grok ');
  return raw;
}

export function formatCursorStreamIdleAfterToolsError(model?: string | null): string {
  const label = cursorModelDisplayName(model);
  return label
    ? `Cursor stopped responding after a tool call (${label})`
    : 'Cursor stopped responding after a tool call';
}

/** Whether the Cursor stream completed a tool and then produced assistant text. */
export type CursorStreamToolProgress = {
  completedTool: boolean;
  assistantAfterTool: boolean;
};

export function createCursorStreamToolProgress(): CursorStreamToolProgress {
  return { completedTool: false, assistantAfterTool: false };
}

/**
 * Track Sideboard agent events from `run.stream()` / `onDelta`.
 * Nested Task stdout (`parentId`) does not count as the parent model continuing.
 */
export function noteCursorAgentEvent(
  state: CursorStreamToolProgress,
  event: { type?: string; partial?: boolean; data?: unknown; parentId?: string },
): void {
  if (event.type === 'tool_result' && event.partial !== true) {
    state.completedTool = true;
    state.assistantAfterTool = false;
    return;
  }
  if (event.type === 'stdout' && !event.parentId) {
    const text = typeof event.data === 'string' ? event.data.trim() : '';
    if (state.completedTool && text) state.assistantAfterTool = true;
  }
}

export function isCursorIdleAfterCompletedTool(state: CursorStreamToolProgress): boolean {
  return state.completedTool && !state.assistantAfterTool;
}
