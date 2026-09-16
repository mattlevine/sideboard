import { describe, expect, it } from 'vitest';
import type { ActiveRun } from '../types/thread.js';
import {
  isWorktreeRunProcessKey,
  mergeWorktreeActiveRuns,
  pickRichestSetupLog,
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
