import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import {
  childFinishedReportPrompt,
  clearParentReportWake,
  notifyParentOfChildReport,
  parentOwesDeferredReport,
  resetParentReportWakes,
} from './child-report.js';

describe('child finished report', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-child-report-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetParentReportWakes();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function parentWith(text: string, patch?: { status?: 'idle' | 'running'; queue?: string[] }) {
    const parent = createEmptyThread({
      title: 'Slack',
      sourceType: 'orchestration',
      sourceRef: 'slack:T1:Umatt',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
    });
    parent.status = patch?.status ?? 'idle';
    parent.queue = patch?.queue ?? [];
    parent.messages = [
      {
        role: 'agent',
        text,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ];
    writeThread(parent);
    return parent;
  }

  function childOf(parentId: string) {
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    const child = createEmptyThread({
      title: 'Approve PRs',
      sourceType: 'pr',
      sourceRef: '12',
      branchName: 'thread/approve',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      parentThreadId: parentId,
    });
    writeThread(child);
    return child;
  }

  it('wakes an idle orchestrator that promised to report later', () => {
    const parent = parentWith("I'll get back to you when the PRs are approved.");
    const child = childOf(parent.id);
    expect(parentOwesDeferredReport(parent)).toBe(true);
    const sends: string[] = [];
    expect(
      notifyParentOfChildReport(child, async (_id, prompt) => {
        sends.push(prompt);
      }),
    ).toBe(true);
    expect(notifyParentOfChildReport(child, async () => undefined)).toBe(false);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain('sideboard://chat/');
    expect(sends[0]).toContain('get_turn_result');
    expect(sends[0]).toContain('not a new user request');
  });

  it('skips a running parent, a queued continue, and a finished report', () => {
    const running = parentWith("I'll get back to you.", { status: 'running' });
    expect(parentOwesDeferredReport(running)).toBe(false);
    const queued = parentWith("I'll follow up when they're done.", {
      queue: ['You ended the turn after promising to report later. Stay on it.'],
    });
    expect(parentOwesDeferredReport(queued)).toBe(false);
    const done = parentWith('Approved 2 PRs.');
    expect(parentOwesDeferredReport(done)).toBe(false);
    expect(notifyParentOfChildReport(childOf(done.id), async () => undefined)).toBe(false);
  });

  it('caps wakes until the parent posts a real outcome', () => {
    const parent = parentWith("I'll get back to you when the PRs are approved.");
    const child = childOf(parent.id);
    expect(notifyParentOfChildReport(child, async () => undefined)).toBe(true);
    parent.messages = [
      {
        role: 'agent',
        text: "I'll get back to you with the rest.",
        ts: '2026-01-01T00:01:00.000Z',
      },
    ];
    writeThread(parent);
    expect(notifyParentOfChildReport(child, async () => undefined)).toBe(true);
    parent.messages = [
      {
        role: 'agent',
        text: "I'll get back to you after that.",
        ts: '2026-01-01T00:02:00.000Z',
      },
    ];
    writeThread(parent);
    expect(notifyParentOfChildReport(child, async () => undefined)).toBe(false);
    clearParentReportWake(parent.id);
    expect(notifyParentOfChildReport(child, async () => undefined)).toBe(true);
  });

  it('names the child that finished', () => {
    const child = childOf('missing');
    expect(childFinishedReportPrompt(child)).toMatch(/Approve PRs/);
    expect(childFinishedReportPrompt(child)).toMatch(/wait_for_turn/);
  });
});
