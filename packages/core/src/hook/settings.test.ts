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

[scripts.run.dev]
command = "PORT=\${CONDUCTOR_PORT:-3000} pnpm dev"
default = true
`,
    );

    const settings = loadRepoSettings(root);
    expect(settings?.source).toBe('conductor');
    expect(settings?.setup).toBe('pnpm install');
    expect(settings?.runScripts[0]?.name).toBe('dev');
    expect(settings?.runScripts[0]?.default).toBe(true);
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
