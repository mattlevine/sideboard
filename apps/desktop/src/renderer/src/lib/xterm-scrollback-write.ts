/** Bytes per write before yielding — keeps remount replay off the critical path. */
export const XTERM_SCROLLBACK_CHUNK = 16_384;

export type XtermWrite = (data: string, next?: () => void) => void;

/**
 * Drop live PTY bytes that are already in a scrollback snapshot.
 *
 * Remount attaches `onData` before `snapshot()` so nothing is lost during the
 * chunked write, but main also appends those bytes to the ring — flushing the
 * raw buffer would replay the overlap (doubled prompt / repeated lines).
 */
export function stripScrollbackOverlap(snapshot: string, live: string): string {
  if (!live) return '';
  if (!snapshot) return live;
  const max = Math.min(snapshot.length, live.length);
  for (let n = max; n > 0; n--) {
    if (snapshot.endsWith(live.slice(0, n))) return live.slice(n);
  }
  return live;
}

/**
 * Replay PTY scrollback into xterm without saturating the main thread.
 *
 * Worktree switches remount `EmbeddedTerminal` and can push up to ~256 KB at
 * once. A single sync `term.write` blocks chat input / sidebar paint; chunk
 * and yield between slices (xterm's write callback, then rAF).
 */
export async function writeXtermScrollback(
  write: XtermWrite,
  data: string,
  opts?: {
    chunkSize?: number;
    /** Defaults to `requestAnimationFrame`. */
    schedule?: (cb: () => void) => void;
    isCancelled?: () => boolean;
  },
): Promise<void> {
  if (!data) return;
  const chunkSize = opts?.chunkSize ?? XTERM_SCROLLBACK_CHUNK;
  const schedule =
    opts?.schedule ??
    ((cb: () => void) => {
      requestAnimationFrame(cb);
    });
  const isCancelled = opts?.isCancelled ?? (() => false);

  for (let i = 0; i < data.length; i += chunkSize) {
    if (isCancelled()) return;
    const slice = data.slice(i, i + chunkSize);
    await new Promise<void>((resolve) => {
      write(slice, () => resolve());
    });
    if (isCancelled()) return;
    if (i + chunkSize < data.length) {
      await new Promise<void>((resolve) => {
        schedule(() => resolve());
      });
    }
  }
}
