import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DETACHED_JOBS_DIR,
} from '../paths/workspace-scratch.js';
import {
  listRunningDetachedJobs,
  looksLikeDeferredDonePromise,
  planJobContinue,
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
    writeFileSync(join(dir, 'pid'), '1\n');
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
});
