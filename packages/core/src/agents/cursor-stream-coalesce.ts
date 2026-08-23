import type { AgentEvent } from '../types/thread.js';

type TextEventType = 'stdout' | 'thinking';

function isTextEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: TextEventType }> {
  return event.type === 'stdout' || event.type === 'thinking';
}

function parentKey(event: { parentId?: string }): string {
  return event.parentId ?? '';
}

/**
 * Token-stream CLIs (Claude `content_block_delta`, Cursor local SDK, …) often
 * emit one-word stdout/thinking frames. Flushing each through orchestrator IPC
 * paints the desktop word-by-word. Coalesce consecutive text (~1 animation
 * frame) and flush immediately on tools / session / errors.
 */
export function createAgentStreamCoalescer(
  emit: (event: AgentEvent) => void,
  opts?: { intervalMs?: number },
): { push: (event: AgentEvent) => void; flush: () => void } {
  const intervalMs = opts?.intervalMs ?? 32;
  let pending: { type: TextEventType; data: string; parentId?: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const event = pending;
    pending = null;
    emit({
      type: event.type,
      data: event.data,
      ...(event.parentId ? { parentId: event.parentId } : {}),
    });
  };

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(flush, intervalMs);
    timer.unref?.();
  };

  return {
    push(event: AgentEvent) {
      if (!isTextEvent(event)) {
        flush();
        emit(event);
        return;
      }
      if (!event.data) return;
      // Status pulses (Claude task_notification) must not glue onto token deltas.
      if (event.type === 'thinking' && event.replace) {
        flush();
        emit(event);
        return;
      }
      if (pending && pending.type === event.type && parentKey(pending) === parentKey(event)) {
        pending.data += event.data;
      } else {
        flush();
        pending = {
          type: event.type,
          data: event.data,
          ...(event.parentId ? { parentId: event.parentId } : {}),
        };
      }
      schedule();
    },
    flush,
  };
}
