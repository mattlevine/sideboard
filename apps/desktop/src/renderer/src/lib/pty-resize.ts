export type PtySize = { cols: number; rows: number };

/**
 * Whether the renderer should ask main to ioctl the PTY. Same-size and
 * 0-size fits are no-ops: macOS still SIGWINCHs, and zsh reprints the
 * focused prompt on every signal.
 *
 * Keep in sync with `shouldApplyPtyResize` in `apps/desktop/src/main/terminal-session.ts`.
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
