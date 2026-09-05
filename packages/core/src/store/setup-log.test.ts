import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSetupLog,
  beginSetupLog,
  finishSetupLog,
  mergeSetupOutput,
  readSetupLog,
  resetSetupLogMemory,
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

  it('marks a new run as running with a cleared buffer', () => {
    appendSetupLog('t1', 'old');
    finishSetupLog('t1', 0);
    const started = beginSetupLog('t1');
    expect(started.running).toBe(true);
    expect(started.output).toBe('');
  });
});
