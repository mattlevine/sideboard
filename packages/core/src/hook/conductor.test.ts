import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceScriptEnv,
  copyConfiguredFiles,
  getRunMode,
  listRunScripts,
  resolveFilesToCopy,
} from './conductor.js';

describe('resolveFilesToCopy', () => {
  it('prefers .worktreeinclude over settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-include-'));
    writeFileSync(join(root, '.worktreeinclude'), '.env*\n.brightsy.json\n# comment\n');
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `[files]\ncopy = [".env"]\n`,
    );
    expect(resolveFilesToCopy(root)).toEqual(['.env*', '.brightsy.json']);
  });

  it('copies matching files from .worktreeinclude', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-copy-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-wt-'));
    writeFileSync(join(root, '.env'), 'A=1\n');
    writeFileSync(join(root, '.brightsy.json'), '{}\n');
    writeFileSync(join(root, '.worktreeinclude'), '.env\n.brightsy.json\n');
    const copied = copyConfiguredFiles(root, wt);
    expect(copied).toEqual(['.env', '.brightsy.json']);
    expect(resolveFilesToCopy(root)).toEqual(['.env', '.brightsy.json']);
  });
});

describe('listRunScripts / runMode', () => {
  it('filters available_in and reads run_mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-run-'));
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `
[scripts]
run_mode = "nonconcurrent"

[scripts.run.dev]
command = "pnpm dev"
default = true
available_in = [ "local" ]

[scripts.run.cloud]
command = "echo cloud"
available_in = [ "cloud" ]
`,
    );
    expect(getRunMode(root)).toBe('nonconcurrent');
    const scripts = listRunScripts(root);
    expect(scripts.map((s) => s.name)).toEqual(['dev']);
  });
});

describe('buildWorkspaceScriptEnv', () => {
  it('sets Sideboard and Conductor aliases', () => {
    const env = buildWorkspaceScriptEnv(
      {
        worktreePath: '/tmp/ws/ajax',
        repoPath: '/tmp/repo',
        workspaceName: 'ajax',
        defaultBranch: 'main',
        ports: [4000, 4001, 4002],
      },
      {},
    );
    expect(env.SIDEBOARD_PORT).toBe('4000');
    expect(env.CONDUCTOR_PORT).toBe('4000');
    expect(env.PORT).toBe('4000');
    expect(env.SIDEBOARD_PORT_1).toBe('4001');
    expect(env.CONDUCTOR_PORT_1).toBe('4001');
    expect(env.SIDEBOARD_WORKSPACE_NAME).toBe('ajax');
    expect(env.CONDUCTOR_ROOT_PATH).toBe('/tmp/repo');
    expect(env.SIDEBOARD_DEFAULT_BRANCH).toBe('main');
    expect(env.SIDEBOARD_IS_LOCAL).toBe('1');
  });
});
