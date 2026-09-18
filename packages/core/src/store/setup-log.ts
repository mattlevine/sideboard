import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import { threadsDir } from './paths.js';

export interface SetupLogSnapshot {
  output: string;
  running: boolean;
  exitCode: number | null;
  source: string | null;
}

const EMPTY: SetupLogSnapshot = {
  output: '',
  running: false,
  exitCode: null,
  source: null,
};

/** Rolling cap on replayable setup output (same order as terminal scrollback). */
export const MAX_SETUP_LOG_CHARS = 256_000;

/** Append a line, keeping the newest bytes once over the cap. */
export function appendSetupOutput(prev: string, line: string, max = MAX_SETUP_LOG_CHARS): string {
  const next = prev ? `${prev}\n${line}` : line;
  if (next.length <= max) return next;
  const cut = next.slice(next.length - max);
  // Start at a line boundary so the pane never opens mid-line.
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
}

/**
 * In-memory form keeps chunks so a `pnpm install` append is O(1) instead of
 * rebuilding a 256 KB string per line. Materialized (joined + capped) on read
 * and persist only.
 */
interface MemSetupLog {
  chunks: string[];
  /** Approximate joined length (chunks + separators) to bound compaction. */
  length: number;
  running: boolean;
  exitCode: number | null;
  source: string | null;
}

const memory = new Map<string, MemSetupLog>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function fromSnapshot(snap: SetupLogSnapshot): MemSetupLog {
  return {
    chunks: snap.output ? [snap.output] : [],
    length: snap.output.length,
    running: snap.running,
    exitCode: snap.exitCode,
    source: snap.source,
  };
}

function materialize(mem: MemSetupLog): SetupLogSnapshot {
  let output = mem.chunks.join('\n');
  if (output.length > MAX_SETUP_LOG_CHARS) {
    output = appendSetupOutput('', output);
    // Compact in place so the next read does not re-join the full history.
    mem.chunks = [output];
    mem.length = output.length;
  }
  return {
    output,
    running: mem.running,
    exitCode: mem.exitCode,
    source: mem.source,
  };
}

export function setupLogPath(threadId: string): string {
  return join(threadsDir(), `${threadId}.setup.log.json`);
}

/** Stable store id for the shared worktree setup pane (not a chat id). */
export function setupLogKeyForWorktree(worktreePath: string): string {
  const norm = normalizeWorktreePath(worktreePath);
  return `wt-${createHash('sha1').update(norm).digest('hex').slice(0, 16)}`;
}

export function emptySetupLog(): SetupLogSnapshot {
  return { ...EMPTY };
}

/** Combine a persisted snapshot with lines that arrived while it was loading. */
export function mergeSetupOutput(prev: string, incoming: string): string {
  if (!prev) return incoming;
  if (!incoming) return prev;
  if (prev === incoming) return prev;
  if (prev.startsWith(incoming) || prev.endsWith(incoming)) return prev;
  if (incoming.startsWith(prev) || incoming.endsWith(prev)) return incoming;
  return incoming.length >= prev.length ? incoming : prev;
}

/** Debounce for persisting a live setup log — one sync write per key per window. */
const PERSIST_DEBOUNCE_MS = 500;

function persistNow(threadId: string): void {
  const timer = persistTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(threadId);
  }
  const mem = memory.get(threadId);
  if (!mem) return;
  try {
    writeFileSync(
      setupLogPath(threadId),
      `${JSON.stringify(materialize(mem))}\n`,
      'utf8',
    );
  } catch {
    // Best-effort — live events still reach a subscribed UI.
  }
}

function schedulePersist(threadId: string): void {
  if (persistTimers.has(threadId)) return;
  persistTimers.set(
    threadId,
    setTimeout(() => {
      persistTimers.delete(threadId);
      persistNow(threadId);
    }, PERSIST_DEBOUNCE_MS),
  );
}

function loadFromDisk(threadId: string): SetupLogSnapshot | null {
  const path = setupLogPath(threadId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SetupLogSnapshot>;
    return {
      output: typeof raw.output === 'string' ? raw.output : '',
      running: Boolean(raw.running),
      exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
      source: typeof raw.source === 'string' ? raw.source : null,
    };
  } catch {
    return null;
  }
}

function memFor(threadId: string): MemSetupLog {
  const cached = memory.get(threadId);
  if (cached) return cached;
  const mem = fromSnapshot(loadFromDisk(threadId) ?? emptySetupLog());
  memory.set(threadId, mem);
  return mem;
}

export function readSetupLog(threadId: string): SetupLogSnapshot {
  const cached = memory.get(threadId);
  if (cached) return materialize(cached);
  const disk = loadFromDisk(threadId);
  if (disk) {
    memory.set(threadId, fromSnapshot(disk));
    return disk;
  }
  return emptySetupLog();
}

export function beginSetupLog(threadId: string): SetupLogSnapshot {
  const mem: MemSetupLog = {
    chunks: [],
    length: 0,
    running: true,
    exitCode: null,
    source: null,
  };
  memory.set(threadId, mem);
  persistNow(threadId);
  return materialize(mem);
}

/**
 * Append one line or a `\n`-joined chunk. O(1) — the buffer is compacted to
 * the rolling cap lazily (once it grows past 2× the cap) and on read/persist.
 */
export function appendSetupLog(threadId: string, line: string): void {
  const mem = memFor(threadId);
  mem.chunks.push(line);
  mem.length += line.length + 1;
  mem.running = true;
  if (mem.length > MAX_SETUP_LOG_CHARS * 2) materialize(mem);
  schedulePersist(threadId);
}

export function finishSetupLog(
  threadId: string,
  exitCode: number | null,
  source?: string | null,
): SetupLogSnapshot {
  const mem = memFor(threadId);
  mem.running = false;
  mem.exitCode = exitCode;
  mem.source = source ?? mem.source;
  persistNow(threadId);
  return materialize(mem);
}

/** Test helper — drop in-memory + debounce state. Disk files stay. */
export function resetSetupLogMemory(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  memory.clear();
}
