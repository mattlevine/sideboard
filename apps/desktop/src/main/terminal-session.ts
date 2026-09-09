export const MAX_TERMINAL_SCROLLBACK = 256_000;

export type TerminalSessionKind = 'shell' | 'attach';

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

export function findReusableTerminalSession<
  T extends { threadRef: string; kind: TerminalSessionKind },
>(
  sessions: Iterable<T>,
  threadRef: string,
  kind: TerminalSessionKind,
): T | undefined {
  for (const session of sessions) {
    if (session.threadRef === threadRef && session.kind === kind) return session;
  }
  return undefined;
}
