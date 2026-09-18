/**
 * Batch per-line script output (setup / run scripts) into one chunk per tick.
 *
 * `pnpm install` emits thousands of lines. Appending each to a 256 KB log and
 * sending each through IPC saturates the Electron main thread while several
 * worktrees are created at once. Consumers already join chunks with `\n`, so
 * a multi-line chunk is a drop-in replacement for a single line.
 */
export function createLineCoalescer(
  onChunk: (chunk: string) => void,
  opts?: { delayMs?: number; maxLines?: number },
): { push: (line: string) => void; flush: () => void } {
  const delayMs = opts?.delayMs ?? 50;
  const maxLines = opts?.maxLines ?? 200;
  let buffer: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const chunk = buffer.join('\n');
    buffer = [];
    onChunk(chunk);
  };

  const push = (line: string): void => {
    buffer.push(line);
    if (buffer.length >= maxLines) {
      flush();
      return;
    }
    if (!timer) timer = setTimeout(flush, delayMs);
  };

  return { push, flush };
}
