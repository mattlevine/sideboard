/** Rolling cap — same order as setup log / PTY scrollback (UI display only). */
export const MAX_SCRIPT_OUTPUT_CHARS = 256_000;

/** Append a line, keeping the newest bytes once over the cap. */
export function appendScriptOutput(
  prev: string,
  line: string,
  max = MAX_SCRIPT_OUTPUT_CHARS,
): string {
  const next = prev ? `${prev}\n${line}` : line;
  if (next.length <= max) return next;
  const cut = next.slice(next.length - max);
  // Start at a line boundary so the pane never opens mid-line.
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
}

/** Combine a persisted setup snapshot with lines that arrived while it loaded. */
export function mergeScriptOutput(prev: string, incoming: string): string {
  if (!prev) return incoming;
  if (!incoming) return prev;
  if (prev === incoming) return prev;
  if (prev.startsWith(incoming) || prev.endsWith(incoming)) return prev;
  if (incoming.startsWith(prev) || incoming.endsWith(prev)) return incoming;
  return incoming.length >= prev.length ? incoming : prev;
}

/**
 * Batch script-output chunks to one React update per animation frame, with a
 * rolling char cap. Chatty Node/Vite servers would otherwise append into an
 * unbounded string and re-render the right sidebar on every coalesced IPC tick.
 *
 * Keep these helpers in the renderer — do not import from `@sideboard-ai/core`
 * (that barrel pulls Node `fs` into the Vite client build).
 */
export function createScriptOutputPainter(
  setOutput: (updater: (prev: string) => string) => void,
): { push: (line: string) => void; clear: () => void; dispose: () => void } {
  let pending: string[] = [];
  let raf = 0;

  const flush = (): void => {
    raf = 0;
    if (pending.length === 0) return;
    const chunk = pending.join('\n');
    pending = [];
    setOutput((prev) => appendScriptOutput(prev, chunk, MAX_SCRIPT_OUTPUT_CHARS));
  };

  return {
    push(line: string) {
      pending.push(line);
      if (!raf) raf = requestAnimationFrame(flush);
    },
    clear() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pending = [];
      setOutput(() => '');
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      pending = [];
    },
  };
}

/**
 * Same as {@link createScriptOutputPainter} but keyed by script name (Run tab
 * can show several concurrent scripts).
 */
export function createKeyedScriptOutputPainter(
  setLogs: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
): {
  push: (key: string, line: string) => void;
  clear: (key?: string) => void;
  dispose: () => void;
} {
  const pending = new Map<string, string[]>();
  let raf = 0;

  const flush = (): void => {
    raf = 0;
    if (pending.size === 0) return;
    const batch = new Map(pending);
    pending.clear();
    setLogs((prev) => {
      let next: Record<string, string> | null = null;
      for (const [key, lines] of batch) {
        const chunk = lines.join('\n');
        const cur = (next ?? prev)[key] ?? '';
        const updated = appendScriptOutput(cur, chunk, MAX_SCRIPT_OUTPUT_CHARS);
        if (updated === cur) continue;
        if (!next) next = { ...prev };
        next[key] = updated;
      }
      return next ?? prev;
    });
  };

  return {
    push(key: string, line: string) {
      let buf = pending.get(key);
      if (!buf) {
        buf = [];
        pending.set(key, buf);
      }
      buf.push(line);
      if (!raf) raf = requestAnimationFrame(flush);
    },
    clear(key?: string) {
      if (key == null) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        pending.clear();
        setLogs(() => ({}));
        return;
      }
      // Keep the shared rAF — cancelling it would strand sibling scripts that
      // still have pending lines until a later push.
      pending.delete(key);
      setLogs((prev) => {
        if (prev[key] === '') return prev;
        return { ...prev, [key]: '' };
      });
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      pending.clear();
    },
  };
}
