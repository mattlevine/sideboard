import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

const memory = new Map<string, SetupLogSnapshot>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setupLogPath(threadId: string): string {
  return join(threadsDir(), `${threadId}.setup.log.json`);
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
    output: current.output ? `${current.output}\n${line}` : line,
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
