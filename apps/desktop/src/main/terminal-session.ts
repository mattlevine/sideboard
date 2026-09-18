export const MAX_TERMINAL_SCROLLBACK = 256_000;

export type TerminalSessionKind = 'shell' | 'attach';

export type PtySize = { cols: number; rows: number };

/**
 * Whether a PTY ioctl should run. macOS `TIOCSWINSZ` SIGWINCHs even when the
 * size is unchanged, and zsh reprints the prompt on every signal — a
 * ResizeObserver / tab-focus fit loop then duplicates the current line.
 *
 * Keep in sync with the renderer helper in `apps/desktop/src/renderer/src/lib/pty-resize.ts`.
 */
export function shouldApplyPtyResize(
  prev: PtySize | null | undefined,
  next: PtySize,
): boolean {
  if (
    !Number.isFinite(next.cols) ||
    !Number.isFinite(next.rows) ||
    next.cols < 1 ||
    next.rows < 1
  ) {
    return false;
  }
  if (prev && prev.cols === next.cols && prev.rows === next.rows) {
    return false;
  }
  return true;
}

/** Cap in-memory PTY scrollback so reconnect can replay without unbounded growth. */
export function appendTerminalScrollback(
  prev: string,
  chunk: string,
  max = MAX_TERMINAL_SCROLLBACK,
): string {
  if (!chunk) return prev;
  const next = prev + chunk;
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

export function terminalSessionKind(opts?: {
  command?: string;
}): TerminalSessionKind {
  return opts?.command ? 'attach' : 'shell';
}

/** Shell is one PTY per worktree; attach stays per chat (agent session). */
export function terminalReuseKey(
  kind: TerminalSessionKind,
  worktreeKey: string,
  threadRef: string,
): string {
  return kind === 'shell' ? `shell:${worktreeKey}` : `attach:${threadRef}`;
}

export function findReusableTerminalSession<
  T extends { reuseKey: string; kind: TerminalSessionKind },
>(
  sessions: Iterable<T>,
  reuseKey: string,
  kind: TerminalSessionKind,
): T | undefined {
  for (const session of sessions) {
    if (session.reuseKey === reuseKey && session.kind === kind) return session;
  }
  return undefined;
}

/**
 * Decide teardown *after* archive/purge settled. Orchestrator serializes
 * sibling archives per worktree, so the live list already excludes this chat
 * and every sibling archived ahead of it — a parallel close of all tabs ends
 * with an empty list on the last one and the shared shell goes with it.
 */
export function teardownInputAfterArchive(
  threadRef: string,
  worktreeKey: string,
  liveWorktreeThreadIds: readonly string[],
): { threadRef: string; worktreeKey: string; lastWorktreeChat: boolean } {
  return {
    threadRef,
    worktreeKey,
    // Archive failed → this chat is still live → keep the shell.
    lastWorktreeChat: !worktreeKey || liveWorktreeThreadIds.length === 0,
  };
}

/** Archive/purge: drop attach for this chat; drop the shared shell only on last tab. */
export function shouldTeardownTerminalSession(
  session: { kind: TerminalSessionKind; threadRef: string; worktreeKey: string },
  input: { threadRef: string; worktreeKey: string; lastWorktreeChat: boolean },
): boolean {
  if (session.kind === 'attach') return session.threadRef === input.threadRef;
  if (input.lastWorktreeChat && input.worktreeKey && session.worktreeKey === input.worktreeKey) {
    return true;
  }
  return !input.worktreeKey && session.threadRef === input.threadRef;
}
