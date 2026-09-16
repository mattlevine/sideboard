import { describe, expect, it } from 'vitest';
import type { ActiveRun } from '../types/thread.js';
import {
  isWorktreeRunProcessKey,
  mergeWorktreeActiveRuns,
  pickRichestSetupLog,
  resolveWorktreeSetupLog,
  worktreeDevProcessKey,
  worktreeRunProcessKey,
  worktreeSetupProcessKey,
} from './worktree-runtime.js';

describe('worktree runtime keys', () => {
  it('keys setup and run by worktree path, not chat id', () => {
    expect(worktreeSetupProcessKey('/wt/paris/')).toBe('wt:/wt/paris:setup');
    expect(worktreeSetupProcessKey('/wt/paris')).toBe('wt:/wt/paris:setup');
    expect(worktreeRunProcessKey('/wt/paris', 'dev')).toBe('wt:/wt/paris:run:dev');
    expect(worktreeDevProcessKey('/wt/paris')).toBe('wt:/wt/paris:dev');
    expect(isWorktreeRunProcessKey('wt:/wt/paris:run:dev', '/wt/paris')).toBe(true);
    expect(isWorktreeRunProcessKey('chat-a:run:dev', '/wt/paris')).toBe(false);
  });
});

describe('pickRichestSetupLog', () => {
  it('prefers a running snapshot, then the longest output', () => {
    const empty = { output: '', running: false, exitCode: null };
    const done = { output: 'ok', running: false, exitCode: 0 };
    const live = { output: '…', running: true, exitCode: null };
    expect(pickRichestSetupLog([empty, done, live])).toEqual(live);
    expect(pickRichestSetupLog([empty, done])).toEqual(done);
    expect(pickRichestSetupLog([empty])).toBeUndefined();
  });
});

describe('resolveWorktreeSetupLog', () => {
  type Snap = { output: string; running: boolean; exitCode: number | null };
  const empty: Snap = { output: '', running: false, exitCode: null };

  it('prefers the worktree log even when a stale sibling chat log is longer (#119)', () => {
    const shared = { output: 'short rerun', running: false, exitCode: 1 };
    const staleSibling = { output: 'a much longer earlier run\nline 2\nline 3', running: false, exitCode: 0 };
    expect(resolveWorktreeSetupLog(shared, [staleSibling])).toBe(shared);
  });

  it('falls back to the richest per-chat log for records that predate the worktree key', () => {
    const legacy = { output: 'old run', running: false, exitCode: 0 };
    expect(resolveWorktreeSetupLog(empty, [empty, legacy])).toBe(legacy);
    expect(resolveWorktreeSetupLog(empty, [empty])).toBeUndefined();
  });

  it('treats a live or finished-but-silent worktree log as present', () => {
    const live: Snap = { output: '', running: true, exitCode: null };
    const silent: Snap = { output: '', running: false, exitCode: 0 };
    const legacy: Snap = { output: 'old run', running: false, exitCode: 0 };
    expect(resolveWorktreeSetupLog(live, [legacy])).toBe(live);
    expect(resolveWorktreeSetupLog(silent, [legacy])).toBe(silent);
  });
});

describe('mergeWorktreeActiveRuns', () => {
  it('unions sibling chat run records', () => {
    const dev: ActiveRun = {
      scriptName: 'dev',
      port: 3000,
      ports: [3000],
      startedAt: '2026-09-15T00:00:00.000Z',
    };
    const test: ActiveRun = {
      scriptName: 'test',
      port: 4000,
      ports: [4000],
      startedAt: '2026-09-15T00:00:01.000Z',
    };
    expect(
      mergeWorktreeActiveRuns([
        { activeRuns: [dev], devPort: 3000 },
        { activeRuns: [dev, test], devPort: 3000 },
        { activeRuns: [], devPort: null },
      ]),
    ).toEqual({ activeRuns: [dev, test], devPort: 3000 });
  });
});
