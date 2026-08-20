/**
 * Cursor SDK session recovery helpers (testable without spawning the runner).
 */

export function cursorErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.trim();
  return String(err).trim();
}

/** SDK conflict when a previous runner died without cancelling. */
export function isAgentBusyError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  if (name === 'AgentBusyError') return true;
  return /already has active run/i.test(cursorErrorMessage(err));
}

/**
 * True when resume (or a cwd-reused create) cannot continue this agent id.
 * Sideboard should start a fresh `Agent.create` instead of failing the turn.
 */
export function isUnresumableCursorSession(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  if (name === 'AgentNotFoundError') return true;
  const lower = cursorErrorMessage(err).toLowerCase();
  if (!lower) return false;
  return (
    /corrupt local agent checkpoint/.test(lower) ||
    /missing root blob/.test(lower) ||
    /\bagent\b.{0,120}\bnot found\b/.test(lower) ||
    /cannot resume/.test(lower)
  );
}

export function cursorSessionRecoveryMessage(err: unknown, agentId?: string | null): string {
  const detail = cursorErrorMessage(err) || 'unresumable session';
  const id = (agentId ?? '').trim();
  if (id) {
    return `Cursor agent ${id} is unresumable (${detail}) — starting a new session`;
  }
  return `Cursor session is unresumable (${detail}) — starting a new session`;
}

/**
 * Local SDK `send()` does not throw `agent_busy`. A previous runner that died
 * leaves a persisted RUNNING run; `force` expires it (SDK: crashed CLI recovery).
 */
export function cursorSendOptions<M>(mcpServers?: M): {
  local: { force: true };
  mcpServers?: M;
} {
  const opts: { local: { force: true }; mcpServers?: M } = { local: { force: true } };
  if (mcpServers && typeof mcpServers === 'object' && Object.keys(mcpServers).length > 0) {
    opts.mcpServers = mcpServers;
  }
  return opts;
}

/**
 * SDK stall auto-retry can drop tool completions and leave the run RUNNING
 * forever. Fail the transport error instead of retrying into a silent hang.
 */
export function withCursorLocalHangGuards<T extends Record<string, unknown>>(
  local: T,
): T & { enableAgentRetries: false } {
  return { ...local, enableAgentRetries: false };
}

/**
 * Local `run.stream()` can stall after the last assistant/tool frame (work is
 * on disk, wait() never resolves). Treat idle as end-of-turn instead of hanging
 * the Sideboard runner forever. Long enough for a quiet shell/test; short
 * enough that wait_for_turn (10 min default) still sees a result.
 */
export const CURSOR_STREAM_IDLE_MS = 180_000;

export async function* iterateUntilIdle<T>(
  iterable: AsyncIterable<T>,
  idleMs: number,
  onIdle?: () => void,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  try {
    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const next = iterator.next();
      const raced = await Promise.race([
        next.then((result) => ({ kind: 'item' as const, result })),
        new Promise<{ kind: 'idle' }>((resolve) => {
          idleTimer = setTimeout(() => resolve({ kind: 'idle' }), idleMs);
          idleTimer.unref?.();
        }),
      ]);
      if (idleTimer) clearTimeout(idleTimer);
      if (raced.kind === 'idle') {
        onIdle?.();
        void iterator.return?.();
        return;
      }
      if (raced.result.done) return;
      yield raced.result.value;
    }
  } catch (err) {
    void iterator.return?.();
    throw err;
  }
}
