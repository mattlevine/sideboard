import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceScriptEnv,
  copyConfiguredFiles,
  getRunMode,
  listRunScripts,
  resolveFilesToCopy,
  runConventionSetup,
  runWorkspaceSetup,
  stripNestedElectronEnv,
} from './conductor.js';
import { REVIEW_SKILL_PATH } from '../review/request-review.js';

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

  it('strips inherited Electron/Chromium env so nested electron-vite can start', () => {
    const env = buildWorkspaceScriptEnv(
      {
        worktreePath: '/tmp/ws/ajax',
        repoPath: '/tmp/repo',
        ports: [5173],
      },
      {
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        CHROME_CRASHPAD_PIPE_NAME: 'crashpad_123',
        SIDEBOARD_WORKSPACE_NAME: 'stale',
      },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(env.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
    expect(env.SIDEBOARD_WORKSPACE_NAME).toBe('ajax');
    expect(env.PORT).toBe('5173');
  });
});

describe('stripNestedElectronEnv', () => {
  it('copies the env and drops only Electron/Chrome keys', () => {
    expect(
      stripNestedElectronEnv({
        HOME: '/Users/me',
        ELECTRON_NO_ASAR: '1',
        CHROME_DESKTOP: 'Sideboard.desktop',
      }),
    ).toEqual({ HOME: '/Users/me' });
  });
});

describe('runConventionSetup / runWorkspaceSetup', () => {
  it('runs script/setup in the worktree', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-conv-'));
    mkdirSync(join(wt, 'script'));
    writeFileSync(join(wt, 'script', 'setup'), '#!/bin/bash\necho ran-setup\n');
    const lines: string[] = [];
    const result = await runConventionSetup(wt, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.source).toBe('script/setup (worktree)');
    expect(lines.join('\n')).toContain('ran-setup');
  });

  it('prefers settings.toml setup over a conventional script', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-ws-'));
    mkdirSync(join(wt, 'script'));
    mkdirSync(join(wt, '.sideboard'));
    writeFileSync(join(wt, 'script', 'setup'), '#!/bin/bash\necho from-convention\n');
    writeFileSync(
      join(wt, '.sideboard', 'settings.toml'),
      `[scripts]\nsetup = "echo from-toml"\n`,
    );
    const lines: string[] = [];
    const result = await runWorkspaceSetup(wt, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.source).toContain('settings.toml');
    expect(lines.join('\n')).toContain('from-toml');
    expect(lines.join('\n')).not.toContain('from-convention');
  });

  it('seeds .claude/skills/review/SKILL.md when missing', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-review-skill-'));
    const lines: string[] = [];
    await runWorkspaceSetup(wt, wt, (l) => lines.push(l));
    expect(existsSync(join(wt, REVIEW_SKILL_PATH))).toBe(true);
    expect(lines.join('\n')).toMatch(/\.claude\/skills\/review\/SKILL\.md/);
  });
});
