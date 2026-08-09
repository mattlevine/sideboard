import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import lockfile from 'proper-lockfile';
import type { Thread, ThreadMessage, ThreadStatus } from '../types/thread.js';
import { threadFilePath, threadLockPath, threadsDir } from './paths.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeThread(raw: Thread): Thread {
  return {
    ...raw,
    model: raw.model ?? null,
    fast: Boolean(raw.fast),
    planMode: Boolean(raw.planMode),
    autonomy: raw.autonomy ?? 'default',
    lastError: raw.lastError ?? null,
    agentPid: raw.agentPid ?? null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    prTitle: raw.prTitle ?? null,
    userSetTitle: Boolean(raw.userSetTitle),
    activeRuns: Array.isArray(raw.activeRuns) ? raw.activeRuns : [],
  };
}

export function createEmptyThread(
  partial: Omit<
    Thread,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'messages'
    | 'queue'
    | 'status'
    | 'devPort'
    | 'activeRuns'
    | 'prUrl'
    | 'prTitle'
    | 'userSetTitle'
    | 'sessionId'
    | 'sourceIsFork'
    | 'parentThreadId'
    | 'autonomy'
    | 'model'
    | 'fast'
    | 'planMode'
    | 'attachments'
  > &
    Partial<
      Pick<
        Thread,
        | 'sessionId'
        | 'sourceIsFork'
        | 'parentThreadId'
        | 'autonomy'
        | 'model'
        | 'fast'
        | 'planMode'
        | 'messages'
        | 'queue'
        | 'status'
        | 'devPort'
        | 'activeRuns'
        | 'prUrl'
        | 'prTitle'
        | 'userSetTitle'
        | 'attachments'
      >
    >,
): Thread {
  const ts = nowIso();
  return {
    id: randomUUID(),
    sessionId: partial.sessionId ?? null,
    autonomy: partial.autonomy ?? 'default',
    model: partial.model ?? null,
    fast: partial.fast ?? false,
    planMode: partial.planMode ?? false,
    sourceIsFork: partial.sourceIsFork ?? false,
    status: partial.status ?? 'idle',
    queue: partial.queue ?? [],
    parentThreadId: partial.parentThreadId ?? null,
    devPort: partial.devPort ?? null,
    activeRuns: partial.activeRuns ?? [],
    prUrl: partial.prUrl ?? null,
    prTitle: partial.prTitle ?? null,
    userSetTitle: partial.userSetTitle ?? false,
    messages: partial.messages ?? [],
    attachments: partial.attachments ?? [],
    createdAt: ts,
    updatedAt: ts,
    title: partial.title,
    sourceType: partial.sourceType,
    sourceRef: partial.sourceRef,
    branchName: partial.branchName,
    worktreePath: partial.worktreePath,
    repoPath: partial.repoPath,
    agent: partial.agent,
    lastError: null,
    agentPid: null,
  };
}

export async function withThreadLock<T>(
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = threadLockPath(id);
  writeFileSync(lockPath, '', { flag: 'a' });
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(lockPath, {
      retries: { retries: 10, minTimeout: 50, maxTimeout: 200 },
      stale: 60_000,
    });
    return await fn();
  } finally {
    if (release) await release();
  }
}

export function readThread(id: string): Thread | null {
  const path = threadFilePath(id);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return normalizeThread(JSON.parse(raw) as Thread);
}

export function writeThread(thread: Thread): void {
  const path = threadFilePath(idPath(thread.id));
  const tmp = `${path}.${process.pid}.tmp`;
  const next = { ...thread, updatedAt: nowIso() };
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, path);
}

function idPath(id: string): string {
  return id;
}

export function listThreads(opts?: { includeArchived?: boolean }): Thread[] {
  const files = readdirSync(threadsDir()).filter((f) => f.endsWith('.json'));
  const threads = files
    .map((f) => {
      try {
        return normalizeThread(
          JSON.parse(readFileSync(threadFilePath(f.replace(/\.json$/, '')), 'utf8')) as Thread,
        );
      } catch {
        return null;
      }
    })
    .filter((t): t is Thread => t !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (opts?.includeArchived) return threads;
  return threads.filter((t) => t.status !== 'archived');
}

export function deleteThreadRecord(id: string): void {
  const path = threadFilePath(id);
  if (existsSync(path)) unlinkSync(path);
  const lock = threadLockPath(id);
  if (existsSync(lock)) {
    try {
      unlinkSync(lock);
    } catch {
      // ignore
    }
  }
}

export function updateThread(
  id: string,
  patch: Partial<Thread>,
): Thread {
  const current = readThread(id);
  if (!current) throw new Error(`Thread not found: ${id}`);
  const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
  writeThread(next);
  return next;
}

export function appendMessage(
  id: string,
  message: ThreadMessage,
): Thread {
  const current = readThread(id);
  if (!current) throw new Error(`Thread not found: ${id}`);
  return updateThread(id, { messages: [...current.messages, message] });
}

export function setStatus(id: string, status: ThreadStatus, lastError?: string | null): Thread {
  return updateThread(id, { status, lastError: lastError ?? null });
}

export function findThreadByRef(ref: string): Thread | null {
  const all = listThreads({ includeArchived: true });
  return (
    all.find((t) => t.id === ref || t.id.startsWith(ref) || t.branchName === ref || t.title === ref) ??
    null
  );
}
