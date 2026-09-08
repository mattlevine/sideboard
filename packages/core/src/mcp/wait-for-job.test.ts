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
  });

  it('lists a live pid as running', () => {
    const root = join(tmpdir(), `sb-job-live-${Date.now()}`);
    const dir = join(root, DETACHED_JOBS_DIR, 'core-test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), `${process.pid}\n`);
    expect(listRunningDetachedJobs(root)).toEqual(['core-test']);
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
