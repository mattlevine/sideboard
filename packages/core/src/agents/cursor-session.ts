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
    // Shared JSONL last-write-wins: `Run run-… not found for agent agent-…`
    /\brun\b.{0,80}\bnot found for agent\b/.test(lower) ||
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
 * SDK `CursorAgentError.isRetryable` — usually a transient create/resume/send
 * transport failure (`Network request failed`). Do not treat auth/credits as
 * retryable even if the message mentions "network".
 */
export function isRetryableCursorTransportError(err: unknown): boolean {
  if (looksLikeNonRetryableCursorFailure(cursorErrorMessage(err))) return false;
  if (
    err &&
    typeof err === 'object' &&
    'isRetryable' in err &&
    (err as { isRetryable?: unknown }).isRetryable === true
  ) {
    return true;
  }
  return /network request failed/i.test(cursorErrorMessage(err));
}

function looksLikeNonRetryableCursorFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /invalid (?:user )?api key|not logged in|not authenticated|unauthorized|credit balance|out of credits|insufficient.?quota/.test(
      lower,
    )
  );
}

export function cursorRetryableTransportMessage(err: unknown): string {
  const detail = cursorErrorMessage(err) || 'network error';
  return `Cursor hit a retryable error (${detail}) — retrying once`;
}

/** Short pause before a create/resume/send retry so a blip can clear. */
export const CURSOR_RETRYABLE_TRANSPORT_DELAY_MS = 1_500;

export async function retryOnceOnRetryableCursorError<T>(
  fn: () => Promise<T>,
  onRetry?: (err: unknown) => void,
  delayMs = CURSOR_RETRYABLE_TRANSPORT_DELAY_MS,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryableCursorTransportError(err)) throw err;
    onRetry?.(err);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return fn();
  }
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
  activity?: { at: number },
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const bump = (): void => {
    if (activity) activity.at = Date.now();
  };
  try {
    let pending = iterator.next();
    while (true) {
      const waitMs = activity
        ? Math.max(0, idleMs - (Date.now() - activity.at))
        : idleMs;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const raced = await Promise.race([
        pending.then((result) => ({ kind: 'item' as const, result })),
        new Promise<{ kind: 'idle' }>((resolve) => {
          idleTimer = setTimeout(() => resolve({ kind: 'idle' }), waitMs);
          idleTimer.unref?.();
        }),
      ]);
      if (idleTimer) clearTimeout(idleTimer);
      if (raced.kind === 'idle') {
        if (activity && Date.now() - activity.at < idleMs) {
          continue;
        }
        onIdle?.();
        void iterator.return?.();
        return;
      }
      if (raced.result.done) return;
      bump();
      yield raced.result.value;
      pending = iterator.next();
    }
  } catch (err) {
    void iterator.return?.();
    throw err;
  }
}
