import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadWorktreeRunPorts,
  saveWorktreeRunPorts,
  worktreeRunPortsPath,
} from './worktree-run-ports.js';

describe('worktree run ports', () => {
  it('round-trips ports per script', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-ports-'));
    expect(loadWorktreeRunPorts(wt, 'dev')).toBeNull();
    saveWorktreeRunPorts(wt, 'dev', [41234, 41235]);
    saveWorktreeRunPorts(wt, 'test', [42000]);
    expect(loadWorktreeRunPorts(wt, 'dev')).toEqual([41234, 41235]);
    expect(loadWorktreeRunPorts(wt, 'test')).toEqual([42000]);
    const written = JSON.parse(readFileSync(worktreeRunPortsPath(wt), 'utf8')) as {
      scripts: Record<string, number[]>;
    };
    expect(written.scripts.dev).toEqual([41234, 41235]);
  });

  it('ignores invalid JSON and non-port values', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-ports-bad-'));
    mkdirSync(join(wt, '.context', '.sideboard'), { recursive: true });
    writeFileSync(worktreeRunPortsPath(wt), 'not-json', 'utf8');
    expect(loadWorktreeRunPorts(wt, 'dev')).toBeNull();
    saveWorktreeRunPorts(wt, 'dev', [0, -1, 80.5, 70000, 40123]);
    expect(loadWorktreeRunPorts(wt, 'dev')).toEqual([40123]);
  });
});
