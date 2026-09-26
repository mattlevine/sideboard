import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RUN_LOG_TAIL_CHARS,
  MAX_RUN_LOG_CHARS,
  appendRunLog,
  beginRunLog,
  finishRunLog,
  flushRunLog,
  readRunLog,
  resetRunLogMemory,
  runLogKeyForWorktree,
  sliceRunLogOutput,
} from './run-log.js';

describe('run log', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-run-log-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetRunLogMemory();
  });

  afterEach(() => {
    resetRunLogMemory();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keys the shared worktree log the same for trailing-slash variants', () => {
    expect(runLogKeyForWorktree('/wt/paris/', 'dev')).toBe(
      runLogKeyForWorktree('/wt/paris', 'dev'),
    );
    expect(runLogKeyForWorktree('/wt/paris', 'dev')).not.toBe(
      runLogKeyForWorktree('/wt/lyon', 'dev'),
    );
    expect(runLogKeyForWorktree('/wt/paris', 'dev')).not.toBe(
      runLogKeyForWorktree('/wt/paris', 'storybook'),
    );
  });

  it('replays persisted output after memory is cleared', () => {
    const key = runLogKeyForWorktree('/wt/paris', 'dev');
    beginRunLog(key, 'dev');
    appendRunLog(key, 'vite v6 ready');
    appendRunLog(key, 'error TS2322');
    flushRunLog(key);
    finishRunLog(key, 1);

    resetRunLogMemory();
    const snap = readRunLog(key);
    expect(snap.running).toBe(false);
    expect(snap.exitCode).toBe(1);
    expect(snap.scriptName).toBe('dev');
    expect(snap.output).toContain('vite v6 ready');
    expect(snap.output).toContain('error TS2322');
  });

  it('caps output at a rolling tail', () => {
    const key = 't-cap';
    beginRunLog(key, 'dev');
    for (let i = 0; i < 4; i++) appendRunLog(key, 'x'.repeat(100_000));
    expect(readRunLog(key).output.length).toBeLessThanOrEqual(MAX_RUN_LOG_CHARS);
  });

  it('slices MCP tails on a line boundary', () => {
    expect(sliceRunLogOutput('short')).toEqual({
      output: 'short',
      truncated: false,
      outputChars: 5,
    });
    const sliced = sliceRunLogOutput('aaaa\nbbbb\ncccc\ndddd', 10);
    expect(sliced.truncated).toBe(true);
    expect(sliced.outputChars).toBe(19);
    expect(sliced.output).not.toMatch(/^[^]*\n[^]*\n/); // at most the newest lines
    expect(sliced.output.endsWith('dddd')).toBe(true);
    expect(DEFAULT_RUN_LOG_TAIL_CHARS).toBe(16_000);
  });

  it('clears the buffer on a new run', () => {
    const key = 't1';
    appendRunLog(key, 'old');
    finishRunLog(key, 0);
    const started = beginRunLog(key, 'dev');
    expect(started.running).toBe(true);
    expect(started.output).toBe('');
    expect(started.scriptName).toBe('dev');
  });
});
