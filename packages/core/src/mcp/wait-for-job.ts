/**
 * Worktree wait/stop for a detached long job (tests, pack, deploy, CLI).
 * Same 45s / stillRunning contract as wait_for_turn so Claude loops
 * instead of ending the turn with "I'll let you know." stopDetachedJob
 * is for hangs / wrong output — not a healthy pack that is making progress.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DETACHED_JOBS_DIR,
  LEGACY_DETACHED_JOBS_DIR,
} from '../paths/workspace-scratch.js';
import { mcpWaitForTurnTimeoutMs } from './wait-for-turn.js';

export const MCP_WAIT_FOR_JOB_MAX_MS = 45_000;
export const MAX_JOB_CONTINUES = 8;

export const MCP_WAIT_JOB_STILL_RUNNING_HINT =
  'Job is still running. The type=log pane already appended this delta. Call wait_for_job again. If it is hanging, producing no useful output, or doing the wrong thing, call stop_job (same id) instead of looping forever. Do not end the turn or tell the user you will let them know later.';
export const MCP_STOP_JOB_HINT =
  'Stopped. The type=log pane is status=failed with the last delta. Do not wait again unless you start a new command.';

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
  stopped?: boolean;
  stopReason?: string;
};

export type StopJobResult = WaitForJobResult & {
  stopped: boolean;
  reason: 'stopped' | 'not-found' | 'not-running' | 'still-running';
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

/** True if any process remains in the wrap pid's group (wrap itself may already be dead). */
export function processGroupAlive(pgid: number): boolean {
  if (process.platform === 'win32') return false;
  // pgid 1 would become process.kill(-1), which signals every process.
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err && typeof err === 'object' && 'code' in err && err.code === 'EPERM';
  }
}

/** Wrap-exit is not "everything is dead" — leftover children keep the job running. */
export function jobTreeAlive(pid: number | null | undefined): boolean {
  if (pid == null) return false;
  return jobAlive(pid) || processGroupAlive(pid);
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
    if (jobTreeAlive(pid)) running.push(id);
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
    'Do not end this turn. Loop wait_for_job (same id) until stillRunning is false. The log pane updates from each wait result.',
    'If the job is hanging or doing the wrong thing, call stop_job (same id) instead of looping forever.',
    'Then report the result. Do not tell the user you will let them know later.',
  ].join(' ');
}

export function formatDeferredDoneContinuePrompt(): string {
  return [
    'You ended the turn after promising to report later, but no detached job is running.',
    'If tests/pack/deploy still need to run: start once with detached-job.cjs, then loop wait_for_job until stillRunning is false (the log pane updates from wait JSON).',
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
    if (/wait_for_job$/i.test(p.name ?? '') || /stop_job$/i.test(p.name ?? '')) return true;
    const blob = [p.name, p.detail, p.description, p.input ? JSON.stringify(p.input) : '']
      .filter(Boolean)
      .join(' ');
    return /detached-job\.(?:js|cjs)\b/i.test(blob);
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

function lastProgressLine(progress: string): string | undefined {
  const last = progress
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== '(no log yet)')
    .at(-1);
  return last ? last.slice(0, 72) : undefined;
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
  const running = jobTreeAlive(pid);
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
  const progress = extra?.progress ?? snap.progress;
  return {
    stillRunning,
    ok,
    failed: Boolean(failed && !stillRunning && !ok),
    status,
    id,
    pid: snap.pid,
    exitCode: snap.exitCode ?? undefined,
    phase: lastProgressLine(progress),
    delta,
    progress,
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
      hint: 'Start with detached-job.cjs start <id> -- <command>, then call wait_for_job again.',
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

function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* fall through to the wrap pid */
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* already dead */
  }
}

function appendJobLog(logFile: string, line: string): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    const body = line.endsWith('\n') ? line : `${line}\n`;
    appendFileSync(logFile, body);
  } catch {
    /* best-effort */
  }
}

/**
 * Stop a detached job the agent decided is hanging or doing the wrong thing.
 * SIGTERM the process group, then SIGKILL after a short grace.
 */
export async function stopDetachedJob(
  cwd: string,
  id: string,
  opts?: {
    reason?: string;
    graceMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<StopJobResult> {
  const jobId = sanitizeDetachedJobId(id);
  const root = cwd.trim() || process.cwd();
  const dir = resolveJobDir(root, jobId);
  const sleep = opts?.sleep ?? sleepMs;
  const why = opts?.reason?.trim() ?? '';

  if (!existsSync(dir)) {
    return {
      stillRunning: false,
      ok: false,
      failed: true,
      status: 'failed',
      id: jobId,
      delta: '',
      progress: 'No detached job. Start one first.',
      hint: 'Start with detached-job.cjs start <id> -- <command>, then wait_for_job or stop_job.',
      stopped: false,
      reason: 'not-found',
    };
  }

  let snap = snapshotJob(dir);
  if (!snap.running) {
    const result = toResult(jobId, snap);
    return {
      ...result,
      stopped: false,
      reason: 'not-running',
      hint: 'That job is already finished. Read the log; do not wait again unless you start a new command.',
    };
  }

  appendJobLog(snap.log, `$ stop${why ? `: ${why}` : ''}`);
  const targetPid = snap.pid;
  if (targetPid != null) killProcessTree(targetPid, 'SIGTERM');
  const graceMs = Number.isFinite(opts?.graceMs)
    ? Math.max(50, opts!.graceMs!)
    : 2_000;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && jobTreeAlive(targetPid)) {
    await sleep(Math.min(100, Math.max(20, deadline - Date.now())));
  }
  // Always SIGKILL the group. Wrap has no SIGTERM handler, so it exits
  // immediately; children that ignore/delay SIGTERM would otherwise leak.
  if (targetPid != null) {
    killProcessTree(targetPid, 'SIGKILL');
    await sleep(100);
  }
  const exitFile = join(dir, 'exit');
  if (!existsSync(exitFile)) {
    try {
      writeFileSync(exitFile, '1\n');
    } catch {
      /* best-effort */
    }
  }
  snap = snapshotJob(dir);
  const stillRunning = jobTreeAlive(targetPid) || snap.running;
  const result = toResult(jobId, snap, { failed: true });
  const stopped = !stillRunning;
  return {
    ...result,
    stillRunning,
    ok: false,
    failed: true,
    status: stillRunning ? 'running' : 'failed',
    stopped,
    reason: stopped ? 'stopped' : 'still-running',
    stopReason: why || undefined,
    hint: stopped ? MCP_STOP_JOB_HINT : MCP_WAIT_JOB_STILL_RUNNING_HINT,
  };
}
