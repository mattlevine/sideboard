/**
 * Worktree wait for a detached long job (tests, pack, deploy).
 * Same 45s / stillRunning contract as wait_for_turn so Claude loops
 * instead of ending the turn with "I'll let you know."
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DETACHED_JOBS_DIR,
  LEGACY_DETACHED_JOBS_DIR,
} from '../paths/workspace-scratch.js';
import { mcpWaitForTurnTimeoutMs } from './wait-for-turn.js';

export const MCP_WAIT_FOR_JOB_MAX_MS = 45_000;
export const MAX_JOB_CONTINUES = 8;

export const MCP_WAIT_JOB_STILL_RUNNING_HINT =
  'Job is still running. present_artifact type=log with the same artifact_id and content=delta (new lines only). Then call wait_for_job again. Do not end the turn or tell the user you will let them know later.';

const JOB_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export type WaitForJobResult = {
  stillRunning: boolean;
  ok: boolean;
  failed: boolean;
  status: 'running' | 'ok' | 'failed' | 'idle';
  id: string;
  pid?: number | null;
  exitCode?: number;
  phase?: string;
  lineCount?: number;
  delta: string;
  progress: string;
  hint?: string;
};

export type JobContinueDecision =
  | { action: 'wait'; prompt: string; jobIds: string[] }
  | { action: 'nudge'; prompt: string }
  | { action: 'none' };

export function mcpWaitForJobTimeoutMs(requested?: number): number {
  return mcpWaitForTurnTimeoutMs(requested);
}

export function sanitizeDetachedJobId(id: string): string {
  const s = id.trim();
  if (!JOB_ID_RE.test(s)) {
    throw new Error(`detached-job id must be 1–64 chars [A-Za-z0-9._-], got ${JSON.stringify(id)}`);
  }
  return s;
}

function jobAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readIntFile(file: string): number | null {
  if (!existsSync(file)) return null;
  const n = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
  return Number.isInteger(n) ? n : null;
}

function jobDir(root: string, id: string, legacy = false): string {
  return join(root, legacy ? LEGACY_DETACHED_JOBS_DIR : DETACHED_JOBS_DIR, id);
}

function resolveJobDir(root: string, id: string): string {
  const modern = jobDir(root, id, false);
  if (existsSync(modern)) return modern;
  const legacy = jobDir(root, id, true);
  if (existsSync(legacy)) return legacy;
  return modern;
}

function listJobIdsIn(root: string, rel: string): string[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && JOB_ID_RE.test(e.name))
    .map((e) => e.name);
}

/** Detached job ids whose pid file is still alive. */
export function listRunningDetachedJobs(worktreePath: string): string[] {
  const root = worktreePath.trim();
  if (!root) return [];
  const ids = new Set([
    ...listJobIdsIn(root, DETACHED_JOBS_DIR),
    ...listJobIdsIn(root, LEGACY_DETACHED_JOBS_DIR),
  ]);
  const running: string[] = [];
  for (const id of ids) {
    const dir = resolveJobDir(root, id);
    const pid = readIntFile(join(dir, 'pid'));
    if (pid != null && jobAlive(pid)) running.push(id);
  }
  return running.sort();
}

/** Last assistant text promised results later instead of waiting. */
export function looksLikeDeferredDonePromise(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return (
    /\b(i['’]?ll|i will)\s+let you know\b/i.test(t) ||
    /\blet you know when\b/i.test(t) ||
    /\b(check back|ping me)\s+when\b/i.test(t) ||
    /\bi(?:['’]ll| will)\s+(report|update you)\s+when\b/i.test(t)
  );
}

export function formatJobStillRunningContinuePrompt(jobIds: string[]): string {
  const ids = jobIds.join(', ');
  return [
    `Detached job still running: ${ids}.`,
    'Do not end this turn. Loop wait_for_job (same id) and present_artifact type=log with content=delta until stillRunning is false.',
    'Then report the result. Do not tell the user you will let them know later.',
  ].join(' ');
}

export function formatDeferredDoneContinuePrompt(): string {
  return [
    'You ended the turn after promising to report later, but no detached job is running.',
    'If tests/pack/deploy still need to run: start once with detached-job.js, present_artifact type=log, then loop wait_for_job until stillRunning is false.',
    'Do not say you will let the user know later.',
  ].join(' ');
}

/** True when this turn started or waited on a detached job. */
export function turnWatchedDetachedJob(
  parts: ReadonlyArray<{
    type?: string;
    name?: string;
    detail?: string;
    description?: string;
    input?: unknown;
  }>,
): boolean {
  return parts.some((p) => {
    if (p.type !== 'tool') return false;
    if (/wait_for_job$/i.test(p.name ?? '')) return true;
    const blob = [p.name, p.detail, p.description, p.input ? JSON.stringify(p.input) : '']
      .filter(Boolean)
      .join(' ');
    return /detached-job\.js\b/i.test(blob);
  });
}

export function planJobContinue(opts: {
  runningJobIds: string[];
  chatText: string;
  queueLength: number;
  continueCount: number;
  alreadyNudged: boolean;
  isOrchestrator: boolean;
  agent?: string | null;
  watchedJob?: boolean;
}): JobContinueDecision {
  if (opts.isOrchestrator) return { action: 'none' };
  if (opts.agent === 'brightsy') return { action: 'none' };
  if (opts.queueLength > 0) return { action: 'none' };
  if (opts.continueCount >= MAX_JOB_CONTINUES) return { action: 'none' };

  const farewell = looksLikeDeferredDonePromise(opts.chatText);
  if (opts.runningJobIds.length > 0 && (farewell || opts.watchedJob)) {
    return {
      action: 'wait',
      jobIds: opts.runningJobIds,
      prompt: formatJobStillRunningContinuePrompt(opts.runningJobIds),
    };
  }
  if (looksLikeDeferredDonePromise(opts.chatText) && !opts.alreadyNudged) {
    return { action: 'nudge', prompt: formatDeferredDoneContinuePrompt() };
  }
  return { action: 'none' };
}

function tailProgress(logFile: string, maxLines = 12): string {
  if (!existsSync(logFile)) return '(no log yet)';
  const lines = readFileSync(logFile, 'utf8').split('\n');
  return lines.slice(-maxLines).join('\n');
}

function readLogLines(file: string): string[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function takeDelta(logFile: string, cursorFile: string): { delta: string; nextCursor: number } {
  const lines = readLogLines(logFile);
  const cursor = readIntFile(cursorFile) ?? 0;
  const start = Math.min(Math.max(0, cursor), lines.length);
  return { delta: lines.slice(start).join('\n'), nextCursor: lines.length };
}

function snapshotJob(dir: string): {
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  log: string;
  cursor: string;
  progress: string;
} {
  const pid = readIntFile(join(dir, 'pid'));
  const running = pid != null && jobAlive(pid);
  return {
    pid,
    running,
    exitCode: readIntFile(join(dir, 'exit')),
    log: join(dir, 'log'),
    cursor: join(dir, 'present.cursor'),
    progress: tailProgress(join(dir, 'log')),
  };
}

function toResult(
  id: string,
  snap: ReturnType<typeof snapshotJob>,
  extra?: { failed?: boolean; progress?: string },
): WaitForJobResult {
  const failed =
    extra?.failed === true ||
    (!snap.running && snap.exitCode != null && snap.exitCode !== 0);
  const ok = !snap.running && snap.exitCode === 0;
  const stillRunning = snap.running && !ok;
  const { delta, nextCursor } = takeDelta(snap.log, snap.cursor);
  try {
    mkdirSync(dirname(snap.cursor), { recursive: true });
    writeFileSync(snap.cursor, `${nextCursor}\n`);
  } catch {
    /* best-effort cursor */
  }
  const status = ok ? 'ok' : failed && !stillRunning ? 'failed' : stillRunning ? 'running' : 'idle';
  return {
    stillRunning,
    ok,
    failed: Boolean(failed && !stillRunning && !ok),
    status,
    id,
    pid: snap.pid,
    exitCode: snap.exitCode ?? undefined,
    delta,
    progress: extra?.progress ?? snap.progress,
    hint: stillRunning ? MCP_WAIT_JOB_STILL_RUNNING_HINT : undefined,
  };
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDetachedJob(
  cwd: string,
  id: string,
  opts?: {
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<WaitForJobResult> {
  const jobId = sanitizeDetachedJobId(id);
  const root = cwd.trim() || process.cwd();
  const dir = resolveJobDir(root, jobId);
  const timeoutMs = mcpWaitForJobTimeoutMs(opts?.timeoutMs);
  const sleep = opts?.sleep ?? sleepMs;

  if (!existsSync(dir)) {
    return {
      stillRunning: false,
      ok: false,
      failed: true,
      status: 'failed',
      id: jobId,
      delta: '',
      progress: 'No detached job. Start one first.',
      hint: 'Start with detached-job.js start <id> -- <command>, then call wait_for_job again.',
    };
  }

  const deadline = Date.now() + timeoutMs;
  let snap = snapshotJob(dir);
  if (snap.exitCode === 0 && !snap.running) return toResult(jobId, snap);
  if (!snap.running && snap.pid == null && snap.progress === '(no log yet)') {
    return toResult(jobId, snap, {
      failed: true,
      progress: 'No detached job. Start one first.',
    });
  }
  while (Date.now() < deadline) {
    snap = snapshotJob(dir);
    if (snap.exitCode === 0 && !snap.running) return toResult(jobId, snap);
    if (!snap.running) return toResult(jobId, snap, { failed: true });
    await sleep(Math.min(2_000, Math.max(50, deadline - Date.now())));
  }
  snap = snapshotJob(dir);
  return toResult(jobId, snap);
}
