import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyThread, readThread, updateThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';
import {
  archiveEphemeralAutomationIfReady,
  EPHEMERAL_AUTOMATION_KEEP,
  ephemeralRunReadyToArchive,
  forgetOlderEphemeralRuns,
} from './ephemeral-automation.js';
import { Orchestrator } from './orchestrator.js';

function chat(over: Partial<Thread> = {}): Thread {
  const thread = createEmptyThread({
    title: 'Standup',
    sourceType: 'orchestration',
    sourceRef: 'go',
    branchName: 'global',
    worktreePath: '/tmp/global',
    repoPath: 'global',
    agent: 'claude',
    status: 'idle',
  });
  return { ...thread, ephemeralAutomationId: 'auto-1', ...over };
}

describe('ephemeralRunReadyToArchive', () => {
  it('archives a finished one-off run', () => {
    expect(ephemeralRunReadyToArchive(chat())).toBe(true);
    expect(ephemeralRunReadyToArchive(chat({ status: 'error' }))).toBe(true);
  });

  it('leaves a continuing chat, a blocked run, and a live turn alone', () => {
    expect(ephemeralRunReadyToArchive(chat({ ephemeralAutomationId: undefined }))).toBe(false);
    expect(ephemeralRunReadyToArchive(chat({ status: 'running' }))).toBe(false);
    expect(ephemeralRunReadyToArchive(chat({ status: 'stopped' }))).toBe(false);
    expect(ephemeralRunReadyToArchive(chat({ queue: ['follow up'] }))).toBe(false);
    expect(
      ephemeralRunReadyToArchive(
        chat({ agentBlock: { source: 'reported', reason: 'Which repo?', at: '2026-01-01T00:00:00.000Z' } }),
      ),
    ).toBe(false);
    expect(ephemeralRunReadyToArchive(chat({ quotaResumeAt: '2099-01-01T00:00:00.000Z' }))).toBe(
      false,
    );
  });
});

describe('forgetOlderEphemeralRuns', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-eph-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    delete process.env.SIDEBOARD_SECRET_VAULT;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps the last five archived runs and a different automation', () => {
    expect(EPHEMERAL_AUTOMATION_KEEP).toBe(5);
    const runs = Array.from({ length: EPHEMERAL_AUTOMATION_KEEP + 1 }, (_, i) =>
      chat({
        id: `run-${i + 1}`,
        status: 'archived',
        archivedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const other = chat({
      id: 'other',
      status: 'archived',
      ephemeralAutomationId: 'auto-2',
      archivedAt: '2020-01-01T00:00:00.000Z',
    });
    const live = chat({ id: 'live', status: 'idle' });
    for (const thread of [...runs, other, live]) writeThread(thread);

    expect(forgetOlderEphemeralRuns('auto-1', 'run-6').sort()).toEqual(['run-1']);
    expect(readThread('run-1')).toBeNull();
    expect(readThread('run-2')?.status).toBe('archived');
    expect(readThread('run-6')?.status).toBe('archived');
    expect(readThread('other')?.id).toBe('other');
    expect(readThread('live')?.id).toBe('live');
  });

  it('keeps an older continuation ahead of a newer source', () => {
    const runs = Array.from({ length: EPHEMERAL_AUTOMATION_KEEP + 1 }, (_, i) =>
      chat({
        id: `run-${i + 1}`,
        status: 'archived',
        archivedAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    for (const thread of runs) writeThread(thread);

    expect(forgetOlderEphemeralRuns('auto-1', 'run-1').sort()).toEqual(['run-2']);
    expect(readThread('run-1')?.id).toBe('run-1');
    expect(readThread('run-2')).toBeNull();
    expect(readThread('run-6')?.id).toBe('run-6');
  });
});

describe('failover continuation owns the one-off', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-eph-failover-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    delete process.env.SIDEBOARD_SECRET_VAULT;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function archive(id: string): Promise<void> {
    updateThread(id, { status: 'archived' });
  }

  it('keeps the continuation after the original drain archives', async () => {
    writeThread(chat({ id: 'orig' }));
    writeThread(chat({ id: 'next', quotaContinuedFromId: 'orig' }));

    await archiveEphemeralAutomationIfReady('orig', archive);
    expect(readThread('orig')?.status).toBe('archived');
    expect(readThread('orig')?.ephemeralAutomationId).toBe('auto-1');
    expect(readThread('next')?.status).toBe('idle');

    await archiveEphemeralAutomationIfReady('next', archive);
    expect(readThread('next')?.status).toBe('archived');
    expect(readThread('next')?.ephemeralAutomationId).toBe('auto-1');
    expect(readThread('orig')?.status).toBe('archived');
  });

  it('does not drop a continuation that archived before the original', async () => {
    writeThread(chat({ id: 'next', status: 'archived', quotaContinuedFromId: 'orig' }));
    writeThread(chat({ id: 'orig' }));

    await archiveEphemeralAutomationIfReady('orig', archive);
    expect(readThread('next')?.status).toBe('archived');
    expect(readThread('next')?.ephemeralAutomationId).toBe('auto-1');
    expect(readThread('orig')?.status).toBe('archived');
  });
});

describe('restore ephemeral automation chat', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-eph-restore-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    delete process.env.SIDEBOARD_SECRET_VAULT;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('clears the one-off flag so a restored chat is not archived again', async () => {
    const thread = chat({
      status: 'archived',
      repoPath: GLOBAL_WORKSPACE_ID,
      archivedAt: '2026-01-02T00:00:00.000Z',
    });
    writeThread(thread);
    const restored = await new Orchestrator().restore(thread.id);
    expect(restored.status).toBe('idle');
    expect(restored.ephemeralAutomationId).toBeUndefined();
    expect(ephemeralRunReadyToArchive(restored)).toBe(false);
    expect(readThread(thread.id)?.ephemeralAutomationId).toBeUndefined();
  });
});
