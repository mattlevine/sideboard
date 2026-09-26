import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import { appendSetupOutput } from './setup-log.js';
import { threadsDir } from './paths.js';

export interface RunLogSnapshot {
  output: string;
  running: boolean;
  exitCode: number | null;
  scriptName: string | null;
}

const EMPTY: RunLogSnapshot = {
  output: '',
  running: false,
  exitCode: null,
  scriptName: null,
};

/** Same rolling cap as setup / the Run pane. */
export const MAX_RUN_LOG_CHARS = 256_000;

/** Default MCP tail — enough for a DTS/Vite error without dumping the full buffer. */
export const DEFAULT_RUN_LOG_TAIL_CHARS = 16_000;

interface MemRunLog {
  chunks: string[];
  length: number;
  running: boolean;
  exitCode: number | null;
  scriptName: string | null;
}

const memory = new Map<string, MemRunLog>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function fromSnapshot(snap: RunLogSnapshot): MemRunLog {
  return {
    chunks: snap.output ? [snap.output] : [],
    length: snap.output.length,
    running: snap.running,
    exitCode: snap.exitCode,
    scriptName: snap.scriptName,
  };
}

function materialize(mem: MemRunLog): RunLogSnapshot {
  let output = mem.chunks.join('\n');
  if (output.length > MAX_RUN_LOG_CHARS) {
    output = appendSetupOutput('', output, MAX_RUN_LOG_CHARS);
    mem.chunks = [output];
    mem.length = output.length;
  }
  return {
    output,
    running: mem.running,
    exitCode: mem.exitCode,
    scriptName: mem.scriptName,
  };
}

function safeScriptToken(scriptName: string): string {
  const token = scriptName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
  return token || 'dev';
}

export function runLogPath(key: string): string {
  return join(threadsDir(), `${key}.run.log.json`);
}

/** Stable store id for one worktree + run-script name. */
export function runLogKeyForWorktree(worktreePath: string, scriptName: string): string {
  const norm = normalizeWorktreePath(worktreePath);
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 16);
  return `wt-${hash}-run-${safeScriptToken(scriptName)}`;
}

export function emptyRunLog(): RunLogSnapshot {
  return { ...EMPTY };
}

/** Newest `tailChars` of output, cut on a line boundary. */
export function sliceRunLogOutput(
  output: string,
  tailChars = DEFAULT_RUN_LOG_TAIL_CHARS,
): { output: string; truncated: boolean; outputChars: number } {
  const max = Math.max(1, tailChars);
  const outputChars = output.length;
  if (outputChars <= max) return { output, truncated: false, outputChars };
  const cut = output.slice(outputChars - max);
  const nl = cut.indexOf('\n');
  const text = nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
  return { output: text, truncated: true, outputChars };
}

const PERSIST_DEBOUNCE_MS = 500;

function persistNow(key: string): void {
  const timer = persistTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(key);
  }
  const mem = memory.get(key);
  if (!mem) return;
  try {
    writeFileSync(runLogPath(key), `${JSON.stringify(materialize(mem))}\n`, 'utf8');
  } catch {
    // Best-effort — live events still reach a subscribed UI.
  }
}

function schedulePersist(key: string): void {
  if (persistTimers.has(key)) return;
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      persistNow(key);
    }, PERSIST_DEBOUNCE_MS),
  );
}

function loadFromDisk(key: string): RunLogSnapshot | null {
  const path = runLogPath(key);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunLogSnapshot>;
    return {
      output: typeof raw.output === 'string' ? raw.output : '',
      running: Boolean(raw.running),
      exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
      scriptName: typeof raw.scriptName === 'string' ? raw.scriptName : null,
    };
  } catch {
    return null;
  }
}

function memFor(key: string): MemRunLog {
  const cached = memory.get(key);
  if (cached) return cached;
  const mem = fromSnapshot(loadFromDisk(key) ?? emptyRunLog());
  memory.set(key, mem);
  return mem;
}

export function readRunLog(key: string): RunLogSnapshot {
  const cached = memory.get(key);
  if (cached) return materialize(cached);
  const disk = loadFromDisk(key);
  if (disk) {
    memory.set(key, fromSnapshot(disk));
    return disk;
  }
  return emptyRunLog();
}

export function beginRunLog(key: string, scriptName: string): RunLogSnapshot {
  const mem: MemRunLog = {
    chunks: [],
    length: 0,
    running: true,
    exitCode: null,
    scriptName,
  };
  memory.set(key, mem);
  persistNow(key);
  return materialize(mem);
}

export function appendRunLog(key: string, line: string): void {
  const mem = memFor(key);
  mem.chunks.push(line);
  mem.length += line.length + 1;
  mem.running = true;
  if (mem.length > MAX_RUN_LOG_CHARS * 2) materialize(mem);
  schedulePersist(key);
}

export function finishRunLog(key: string, exitCode: number | null): RunLogSnapshot {
  const mem = memFor(key);
  mem.running = false;
  mem.exitCode = exitCode;
  persistNow(key);
  return materialize(mem);
}

/** Flush the debounce so MCP (other process) can read the latest tail. */
export function flushRunLog(key: string): void {
  persistNow(key);
}

/** Test helper — drop in-memory + debounce state. Disk files stay. */
export function resetRunLogMemory(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  memory.clear();
}
