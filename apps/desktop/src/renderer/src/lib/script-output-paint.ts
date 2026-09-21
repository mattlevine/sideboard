import { appendSetupOutput, MAX_SETUP_LOG_CHARS } from '@sideboard-ai/core';

/** Same rolling cap as setup log / PTY scrollback — keep the newest bytes. */
export const MAX_SCRIPT_OUTPUT_CHARS = MAX_SETUP_LOG_CHARS;

export { appendSetupOutput };

/**
 * Batch script-output chunks to one React update per animation frame, with a
 * rolling char cap. Chatty Node/Vite servers would otherwise append into an
 * unbounded string and re-render the right sidebar on every coalesced IPC tick.
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
    setOutput((prev) => appendSetupOutput(prev, chunk, MAX_SCRIPT_OUTPUT_CHARS));
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
        const updated = appendSetupOutput(cur, chunk, MAX_SCRIPT_OUTPUT_CHARS);
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
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (key == null) {
        pending.clear();
        setLogs(() => ({}));
        return;
      }
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
