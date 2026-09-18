import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_SETUP_LOG_CHARS,
  appendSetupLog,
  appendSetupOutput,
  beginSetupLog,
  finishSetupLog,
  mergeSetupOutput,
  readSetupLog,
  resetSetupLogMemory,
  setupLogKeyForWorktree,
} from './setup-log.js';

describe('setup log', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-setup-log-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetSetupLogMemory();
  });

  afterEach(() => {
    resetSetupLogMemory();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('caps setup output at a rolling tail on a line boundary', () => {
    expect(appendSetupOutput('', 'first')).toBe('first');
    expect(appendSetupOutput('first', 'second')).toBe('first\nsecond');
    const rolled = appendSetupOutput('aaaa\nbbbb\ncccc', 'dddd', 10);
    expect(rolled.length).toBeLessThanOrEqual(10);
    expect(rolled).toBe('cccc\ndddd');
    beginSetupLog('t-cap');
    for (let i = 0; i < 4; i++) appendSetupLog('t-cap', 'x'.repeat(100_000));
    expect(readSetupLog('t-cap').output.length).toBeLessThanOrEqual(MAX_SETUP_LOG_CHARS);
  });

  it('replays persisted output after memory is cleared', () => {
    beginSetupLog('t1');
    appendSetupLog('t1', '[setup] .sideboard/settings.toml (worktree)');
    appendSetupLog('t1', 'pnpm install');
    finishSetupLog('t1', 0, '.sideboard/settings.toml (worktree)');

    resetSetupLogMemory();
    const snap = readSetupLog('t1');
    expect(snap.running).toBe(false);
    expect(snap.exitCode).toBe(0);
    expect(snap.output).toContain('[setup] .sideboard/settings.toml (worktree)');
    expect(snap.output).toContain('pnpm install');
  });

  it('merges a persisted prefix with live tail lines', () => {
    expect(mergeSetupOutput('a\nb', 'a\nb\nc')).toBe('a\nb\nc');
    expect(mergeSetupOutput('b\nc', 'a\nb\nc')).toBe('a\nb\nc');
    expect(mergeSetupOutput('a\nb\nc', 'a\nb')).toBe('a\nb\nc');
    expect(mergeSetupOutput('', 'hello')).toBe('hello');
  });

  it('keys the shared worktree log the same for trailing-slash variants', () => {
    expect(setupLogKeyForWorktree('/wt/paris/')).toBe(setupLogKeyForWorktree('/wt/paris'));
    expect(setupLogKeyForWorktree('/wt/paris')).not.toBe(setupLogKeyForWorktree('/wt/lyon'));
  });

  it('accepts multi-line chunks and keeps line order', () => {
    beginSetupLog('t-chunk');
    appendSetupLog('t-chunk', 'a\nb');
    appendSetupLog('t-chunk', 'c');
    expect(readSetupLog('t-chunk').output).toBe('a\nb\nc');
  });

  it('does not rebuild the joined string on every append', () => {
    beginSetupLog('t-many');
    const line = 'x'.repeat(200);
    // ~3× the cap in 200-char lines — must stay fast (O(1) append + lazy compaction).
    const started = Date.now();
    for (let i = 0; i < (MAX_SETUP_LOG_CHARS * 3) / 200; i++) appendSetupLog('t-many', line);
    const snap = readSetupLog('t-many');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(snap.output.length).toBeLessThanOrEqual(MAX_SETUP_LOG_CHARS);
    expect(snap.output.endsWith(line)).toBe(true);
  });

  it('marks a new run as running with a cleared buffer', () => {
    appendSetupLog('t1', 'old');
    finishSetupLog('t1', 0);
    const started = beginSetupLog('t1');
    expect(started.running).toBe(true);
    expect(started.output).toBe('');
  });
});
