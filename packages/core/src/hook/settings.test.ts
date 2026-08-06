import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasRepoHook,
  hasWorkspaceHook,
  getRepoSetupInfo,
  loadRepoSettings,
  loadWorkspaceSettings,
  settingsSourceLabel,
} from './settings.js';

describe('loadRepoSettings', () => {
  it('prefers .sideboard/settings.toml over .conductor', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-settings-'));
    mkdirSync(join(root, '.sideboard'));
    mkdirSync(join(root, '.conductor'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `[scripts]\nsetup = "echo sideboard"\n`,
    );
    writeFileSync(
      join(root, '.conductor', 'settings.toml'),
      `[scripts]\nsetup = "echo conductor"\n`,
    );

    const settings = loadRepoSettings(root);
    expect(settings?.source).toBe('sideboard');
    expect(settings?.setup).toBe('echo sideboard');
    expect(settingsSourceLabel(root)).toBe('.sideboard/settings.toml');
    expect(hasRepoHook(root)).toBe(true);
  });

  it('falls back to .conductor/settings.toml', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-settings-'));
    mkdirSync(join(root, '.conductor'));
    writeFileSync(
      join(root, '.conductor', 'settings.toml'),
      `
[scripts]
setup = "pnpm install"
archive = "echo cleanup"
run_mode = "nonconcurrent"

[scripts.run.dev]
command = "PORT=\${CONDUCTOR_PORT:-3000} pnpm dev"
default = true
icon = "play"
available_in = [ "local" ]

[scripts.run.test]
command = "pnpm test:watch"
icon = "test-tube"
`,
    );

    const settings = loadRepoSettings(root);
    expect(settings?.source).toBe('conductor');
    expect(settings?.setup).toBe('pnpm install');
    expect(settings?.archive).toBe('echo cleanup');
    expect(settings?.runMode).toBe('nonconcurrent');
    expect(settings?.runScripts[0]?.name).toBe('dev');
    expect(settings?.runScripts[0]?.default).toBe(true);
    expect(settings?.runScripts[0]?.icon).toBe('play');
    expect(settings?.runScripts[0]?.availableIn).toEqual(['local']);
    expect(settings?.runScripts[1]?.name).toBe('test');
  });

  it('reads worktrees.root override with ~ expansion', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-settings-'));
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `[worktrees]\nroot = "~/custom-sideboard-wts"\n`,
    );
    const settings = loadRepoSettings(root);
    expect(settings?.worktreesRoot?.endsWith('custom-sideboard-wts')).toBe(true);
    expect(settings?.worktreesRoot?.includes('~')).toBe(false);
  });
});

describe('getRepoSetupInfo', () => {
  it('reports missing config', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-setup-info-'));
    expect(getRepoSetupInfo(root)).toEqual({
      hasConfig: false,
      hasSetupScript: false,
      configLabel: null,
    });
  });

  it('reports config without setup script', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-setup-info-'));
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(join(root, '.sideboard', 'settings.toml'), `[scripts.run.dev]\ncommand = "pnpm dev"\n`);
    expect(getRepoSetupInfo(root)).toEqual({
      hasConfig: true,
      hasSetupScript: false,
      configLabel: '.sideboard/settings.toml (worktree)',
    });
  });

  it('reports config with setup script', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-setup-info-'));
    mkdirSync(join(root, '.conductor'));
    writeFileSync(
      join(root, '.conductor', 'settings.toml'),
      `[scripts]\nsetup = "pnpm install"\n`,
    );
    expect(getRepoSetupInfo(root)).toEqual({
      hasConfig: true,
      hasSetupScript: true,
      configLabel: '.conductor/settings.toml (worktree)',
    });
  });

  it('prefers worktree settings over main repo', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-wt-'));
    mkdirSync(join(repo, '.sideboard'));
    mkdirSync(join(wt, '.sideboard'));
    writeFileSync(join(repo, '.sideboard', 'settings.toml'), `[scripts]\nsetup = "echo repo"\n`);
    writeFileSync(join(wt, '.sideboard', 'settings.toml'), `[scripts]\nsetup = "echo wt"\n`);

    expect(loadWorkspaceSettings(wt, repo)?.setup).toBe('echo wt');
    expect(hasWorkspaceHook(wt, repo)).toBe(true);
    expect(getRepoSetupInfo(wt, repo).configLabel).toBe('.sideboard/settings.toml (worktree)');
  });

  it('falls back to main repo when worktree has no config', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-wt-'));
    mkdirSync(join(repo, '.sideboard'));
    writeFileSync(
      join(repo, '.sideboard', 'settings.toml'),
      `[scripts]\nsetup = "echo repo"\n[scripts.run.dev]\ncommand = "pnpm dev"\ndefault = true\n`,
    );

    expect(loadWorkspaceSettings(wt, repo)?.setup).toBe('echo repo');
    expect(getRepoSetupInfo(wt, repo)).toEqual({
      hasConfig: true,
      hasSetupScript: true,
      configLabel: '.sideboard/settings.toml (main repo)',
    });
  });
});

describe('settings.local.toml', () => {
  it('overlays local run scripts on committed settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-local-'));
    mkdirSync(join(root, '.conductor'));
    writeFileSync(
      join(root, '.conductor', 'settings.toml'),
      `[scripts]\nsetup = "pnpm install"\n`,
    );
    writeFileSync(
      join(root, '.conductor', 'settings.local.toml'),
      `[scripts.run.dev]\ncommand = "pnpm dev:local"\ndefault = true\nicon = "play"\n`,
    );

    const settings = loadRepoSettings(root);
    expect(settings?.setup).toBe('pnpm install');
    expect(settings?.runScripts).toEqual([
      { name: 'dev', command: 'pnpm dev:local', default: true, icon: 'play' },
    ]);
  });

  it('applies main-repo settings.local.toml to a worktree (Conductor parity)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-repo-local-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-wt-local-'));
    mkdirSync(join(repo, '.conductor'));
    mkdirSync(join(wt, '.conductor'));
    // Worktree has committed snapshot without run scripts (common mid-migration).
    writeFileSync(
      join(wt, '.conductor', 'settings.toml'),
      `[scripts]\nsetup = "pnpm install"\n`,
    );
    // Machine-local on main checkout — Conductor applies this to every workspace.
    writeFileSync(
      join(repo, '.conductor', 'settings.local.toml'),
      `[scripts.run.dev]\ncommand = "pnpm --filter web dev"\ndefault = true\n`,
    );

    const settings = loadWorkspaceSettings(wt, repo);
    expect(settings?.setup).toBe('pnpm install');
    expect(settings?.runScripts[0]?.command).toBe('pnpm --filter web dev');
    expect(hasWorkspaceHook(wt, repo)).toBe(true);
  });

  it('loads run scripts from settings.local.toml alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-local-only-'));
    mkdirSync(join(root, '.conductor'));
    writeFileSync(
      join(root, '.conductor', 'settings.local.toml'),
      `[scripts.run.dev]\ncommand = "pnpm dev"\ndefault = true\n`,
    );
    expect(loadRepoSettings(root)?.runScripts[0]?.name).toBe('dev');
    expect(hasRepoHook(root)).toBe(true);
  });
});
