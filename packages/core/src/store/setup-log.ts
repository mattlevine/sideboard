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

const memory = new Map<string, SetupLogSnapshot>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function clone(snap: SetupLogSnapshot): SetupLogSnapshot {
  return { ...snap };
}

function persistNow(threadId: string): void {
  const timer = persistTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(threadId);
  }
  const snap = memory.get(threadId);
  if (!snap) return;
  try {
    writeFileSync(setupLogPath(threadId), `${JSON.stringify(snap)}\n`, 'utf8');
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
    }, 100),
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

export function readSetupLog(threadId: string): SetupLogSnapshot {
  const cached = memory.get(threadId);
  if (cached) return clone(cached);
  const disk = loadFromDisk(threadId);
  if (disk) {
    memory.set(threadId, disk);
    return clone(disk);
  }
  return emptySetupLog();
}

export function beginSetupLog(threadId: string): SetupLogSnapshot {
  const snap: SetupLogSnapshot = {
    output: '',
    running: true,
    exitCode: null,
    source: null,
  };
  memory.set(threadId, snap);
  persistNow(threadId);
  return clone(snap);
}

export function appendSetupLog(threadId: string, line: string): SetupLogSnapshot {
  const current = memory.get(threadId) ?? readSetupLog(threadId);
  const snap: SetupLogSnapshot = {
    ...current,
    output: appendSetupOutput(current.output, line),
    running: true,
  };
  memory.set(threadId, snap);
  schedulePersist(threadId);
  return clone(snap);
}

export function finishSetupLog(
  threadId: string,
  exitCode: number | null,
  source?: string | null,
): SetupLogSnapshot {
  const current = memory.get(threadId) ?? readSetupLog(threadId);
  const snap: SetupLogSnapshot = {
    ...current,
    running: false,
    exitCode,
    source: source ?? current.source,
  };
  memory.set(threadId, snap);
  persistNow(threadId);
  return clone(snap);
}

/** Test helper — drop in-memory + debounce state. Disk files stay. */
export function resetSetupLogMemory(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  memory.clear();
}
