import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyThread, readThread } from '../store/thread-store.js';
import { writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';
import {
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

  it('keeps the latest archived run and a different automation', () => {
    const keep = chat({ id: 'keep', status: 'archived' });
    const old = chat({ id: 'old', status: 'archived' });
    const other = chat({ id: 'other', status: 'archived', ephemeralAutomationId: 'auto-2' });
    const live = chat({ id: 'live', status: 'idle' });
    for (const thread of [keep, old, other, live]) writeThread(thread);

    expect(forgetOlderEphemeralRuns('auto-1', 'keep').sort()).toEqual(['old']);
    expect(readThread('keep')?.status).toBe('archived');
    expect(readThread('old')).toBeNull();
    expect(readThread('other')?.id).toBe('other');
    expect(readThread('live')?.id).toBe('live');
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
