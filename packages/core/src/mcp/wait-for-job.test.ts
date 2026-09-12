import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DETACHED_JOBS_DIR,
} from '../paths/workspace-scratch.js';
import {
  jobTreeAlive,
  listRunningDetachedJobs,
  processGroupAlive,
  capJobLogDelta,
  collapseGhRunWatchLog,
  isJobContinuePrompt,
  looksLikeDeferredDonePromise,
  planJobContinue,
  stopDetachedJob,
  waitForDetachedJob,
} from './wait-for-job.js';

describe('looksLikeDeferredDonePromise', () => {
  it('matches I’ll-let-you-know farewells', () => {
    expect(looksLikeDeferredDonePromise("I'll let you know when they're done.")).toBe(
      true,
    );
    expect(looksLikeDeferredDonePromise('I will let you know when the tests finish.')).toBe(
      true,
    );
    expect(looksLikeDeferredDonePromise('Check back when the pack is done.')).toBe(true);
  });

  it('ignores a finished report', () => {
    expect(looksLikeDeferredDonePromise('Tests passed. Ready to commit.')).toBe(false);
    expect(looksLikeDeferredDonePromise('')).toBe(false);
  });

  it('ignores quoted examples and long explanations', () => {
    expect(
      looksLikeDeferredDonePromise(
        'That bubble is the continue after the agent quoted “I’ll let you know.”',
      ),
    ).toBe(false);
    expect(
      looksLikeDeferredDonePromise(
        `${'This is documentation about the continue logic. '.repeat(12)}I'll let you know when they're done.`,
      ),
    ).toBe(false);
  });
});

describe('collapseGhRunWatchLog / capJobLogDelta', () => {
  const frame = (n: number) =>
    `Refreshing run status every 3 seconds. Press Ctrl+C to quit.\n\n* v0.1.187 Release\n* Build step ${n}\n`;

  it('keeps the last gh run watch frame', () => {
    const log = `${frame(1)}${frame(2)}${frame(3)}`;
    const out = collapseGhRunWatchLog(log);
    expect(out).toMatch(/2 identical gh run watch refreshes omitted/);
    expect(out).toMatch(/Build step 3/);
    expect(out).not.toMatch(/Build step 1/);
  });

  it('caps a long delta', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    const out = capJobLogDelta(lines.join('\n'));
    expect(out).toMatch(/earlier lines omitted/);
    expect(out).toMatch(/line 119/);
    expect(out).not.toMatch(/line 0\n/);
  });
});

describe('isJobContinuePrompt', () => {
  it('matches host keep-alives', () => {
    expect(isJobContinuePrompt('Detached job still running: gha-release. Loop wait_for_job.')).toBe(
      true,
    );
    expect(
      isJobContinuePrompt(
        'You ended the turn after promising to report later, but no detached job is running.',
      ),
    ).toBe(true);
    expect(isJobContinuePrompt('merge in new updates')).toBe(false);
  });
});

describe('planJobContinue', () => {
  it('resumes when a detached job is still running', () => {
    const d = planJobContinue({
      runningJobIds: ['core-test'],
      chatText: "I'll let you know when they're done.",
      queueLength: 0,
      continueCount: 0,
      alreadyNudged: false,
      isOrchestrator: false,
    });
    expect(d.action).toBe('wait');
    if (d.action === 'wait') {
      expect(d.prompt).toMatch(/wait_for_job/);
      expect(d.jobIds).toEqual(['core-test']);
    }
  });

  it('nudges once when the farewell has no running job', () => {
    const d = planJobContinue({
      runningJobIds: [],
      chatText: "I'll let you know when the tests are done.",
      queueLength: 0,
      continueCount: 0,
      alreadyNudged: false,
      isOrchestrator: false,
    });
    expect(d.action).toBe('nudge');
  });

  it('does not resume a leftover job on an unrelated turn', () => {
    expect(
      planJobContinue({
        runningJobIds: ['core-test'],
        chatText: 'Renamed the helper.',
        queueLength: 0,
        continueCount: 0,
        alreadyNudged: false,
        isOrchestrator: false,
        watchedJob: false,
      }).action,
    ).toBe('none');
  });

  it('skips orchestrators, queued follow-ups, and a second nudge', () => {
    expect(
      planJobContinue({
        runningJobIds: ['core-test'],
        chatText: '',
        queueLength: 0,
        continueCount: 0,
        alreadyNudged: false,
        isOrchestrator: true,
      }).action,
    ).toBe('none');
    expect(
      planJobContinue({
        runningJobIds: ['core-test'],
        chatText: '',
        queueLength: 1,
        continueCount: 0,
        alreadyNudged: false,
        isOrchestrator: false,
      }).action,
    ).toBe('none');
    expect(
      planJobContinue({
        runningJobIds: [],
        chatText: "I'll let you know.",
        queueLength: 0,
        continueCount: 0,
        alreadyNudged: true,
        isOrchestrator: false,
      }).action,
    ).toBe('none');
  });
});

describe('waitForDetachedJob / listRunningDetachedJobs', () => {
  it('fails immediately when no job exists', async () => {
    const root = join(tmpdir(), `sb-job-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const result = await waitForDetachedJob(root, 'core-test', { timeoutMs: 1000 });
    expect(result.failed).toBe(true);
    expect(result.stillRunning).toBe(false);
    expect(result.progress).toMatch(/No detached job/);
  });

  it('returns ok when the job already exited 0', async () => {
    const root = join(tmpdir(), `sb-job-ok-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'core-test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), '999999999\n');
    writeFileSync(join(dir, 'exit'), '0\n');
    writeFileSync(join(dir, 'log'), 'ok\n');
    const result = await waitForDetachedJob(root, 'core-test', { timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(result.stillRunning).toBe(false);
    expect(result.delta).toMatch(/ok/);
    expect(result.phase).toBe('ok');
  });

  it('collapses repeated gh run watch frames in delta', async () => {
    const root = join(tmpdir(), `sb-job-watch-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'gha-release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), '999999999\n');
    writeFileSync(join(dir, 'exit'), '0\n');
    const frame = (n: number) =>
      `Refreshing run status every 3 seconds. Press Ctrl+C to quit.\n\n* Release\n* step ${n}\n`;
    writeFileSync(join(dir, 'log'), `${frame(1)}${frame(2)}${frame(3)}`);
    const result = await waitForDetachedJob(root, 'gha-release', { timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(result.delta).toMatch(/step 3/);
    expect(result.delta).toMatch(/omitted/);
    expect(result.delta).not.toMatch(/step 1/);
  });

  it('lists a live pid as running', () => {
    const root = join(tmpdir(), `sb-job-live-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'core-test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), `${process.pid}\n`);
    expect(listRunningDetachedJobs(root)).toEqual(['core-test']);
  });

  it('processGroupAlive rejects pid 1 so we never signal every process', () => {
    expect(processGroupAlive(1)).toBe(false);
    expect(processGroupAlive(0)).toBe(false);
    expect(processGroupAlive(-3)).toBe(false);
  });

  it('lists leftover children after wrap exits', async () => {
    const root = join(tmpdir(), `sb-job-list-wrap-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'hang');
    mkdirSync(dir, { recursive: true });
    const { wrapPid, cleanup } = await spawnWrapWithStubbornChild(dir);
    try {
      process.kill(wrapPid, 'SIGKILL');
      await waitUntil(() => !pidAlive(wrapPid), 2_000);
      expect(jobTreeAlive(wrapPid)).toBe(true);
      expect(listRunningDetachedJobs(root)).toEqual(['hang']);
    } finally {
      cleanup();
    }
  });

  it('stopDetachedJob kills a live sleep and marks failed', async () => {
    const root = join(tmpdir(), `sb-job-stop-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'hang');
    mkdirSync(dir, { recursive: true });
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    child.unref();
    writeFileSync(join(dir, 'pid'), `${child.pid}\n`);
    writeFileSync(join(dir, 'log'), 'waiting\n');
    const result = await stopDetachedJob(root, 'hang', {
      reason: 'no progress',
      graceMs: 800,
    });
    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('stopped');
    expect(result.failed).toBe(true);
    expect(result.stillRunning).toBe(false);
    expect(result.stopReason).toBe('no progress');
    expect(result.progress).toMatch(/\$ stop: no progress/);
  });

  it('stopDetachedJob is a no-op when the id is missing', async () => {
    const root = join(tmpdir(), `sb-job-stop-miss-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const result = await stopDetachedJob(root, 'gone');
    expect(result.stopped).toBe(false);
    expect(result.reason).toBe('not-found');
  });

  it('stopDetachedJob SIGKILLs leftover children after wrap exits', async () => {
    const root = join(tmpdir(), `sb-job-stop-wrap-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'hang');
    mkdirSync(dir, { recursive: true });
    const { wrapPid, childPid, cleanup } = await spawnWrapWithStubbornChild(dir);
    try {
      expect(jobTreeAlive(wrapPid)).toBe(true);
      const result = await stopDetachedJob(root, 'hang', { graceMs: 400 });
      expect(result.stopped).toBe(true);
      expect(result.reason).toBe('stopped');
      expect(result.stillRunning).toBe(false);
      expect(result.status).toBe('failed');
      expect(jobTreeAlive(wrapPid)).toBe(false);
      expect(pidAlive(childPid)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('stopDetachedJob still SIGKILLs the group when wrap is already dead', async () => {
    const root = join(tmpdir(), `sb-job-stop-dead-wrap-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'hang');
    mkdirSync(dir, { recursive: true });
    const { wrapPid, childPid, cleanup } = await spawnWrapWithStubbornChild(dir);
    try {
      process.kill(wrapPid, 'SIGKILL');
      await waitUntil(() => !pidAlive(wrapPid), 2_000);
      expect(pidAlive(childPid)).toBe(true);
      expect(jobTreeAlive(wrapPid)).toBe(true);
      const result = await stopDetachedJob(root, 'hang', { graceMs: 400 });
      expect(result.stopped).toBe(true);
      expect(result.stillRunning).toBe(false);
      expect(result.status).toBe('failed');
      expect(pidAlive(childPid)).toBe(false);
      expect(jobTreeAlive(wrapPid)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(pred: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timed out after ${ms}ms`);
}

async function spawnWrapWithStubbornChild(dir: string): Promise<{
  wrapPid: number;
  childPid: number;
  cleanup: () => void;
}> {
  const childPidFile = join(dir, 'child.pid');
  const stubborn = `
    process.on('SIGTERM', () => {});
    require('fs').writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `;
  const wrapCode = `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(stubborn)}], { stdio: 'ignore' });
    child.unref();
    setInterval(() => {}, 1000);
  `;
  const wrap = spawn(process.execPath, ['-e', wrapCode], {
    detached: true,
    stdio: 'ignore',
  });
  wrap.unref();
  const wrapPid = wrap.pid;
  if (wrapPid == null) throw new Error('wrap pid missing');
  writeFileSync(join(dir, 'pid'), `${wrapPid}\n`);
  writeFileSync(join(dir, 'log'), 'waiting\n');
  await waitUntil(() => existsSync(childPidFile), 3_000);
  const childPid = Number.parseInt(readFileSync(childPidFile, 'utf8').trim(), 10);
  if (!Number.isInteger(childPid) || childPid <= 0) throw new Error('child pid missing');
  return {
    wrapPid,
    childPid,
    cleanup: () => {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      try {
        process.kill(-wrapPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      try {
        process.kill(wrapPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    },
  };
}
