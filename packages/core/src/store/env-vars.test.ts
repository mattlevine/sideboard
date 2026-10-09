import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateAppEnvironment } from './app-settings.js';
import {
  classifyEnvKey,
  deleteEnvVar,
  formatEnvDirective,
  formatEnvReminder,
  listEnvKeys,
  projectEnvPrefix,
  projectNameForRepoPath,
  qualifyProjectEnvKey,
  setEnvVar,
} from './env-vars.js';

describe('project env vars', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-env-vars-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevVault === undefined) delete process.env.SIDEBOARD_SECRET_VAULT;
    else process.env.SIDEBOARD_SECRET_VAULT = prevVault;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('builds a prefix from the project name', () => {
    expect(projectEnvPrefix('sideboard')).toBe('SIDEBOARD_');
    expect(projectEnvPrefix('My App')).toBe('MY_APP_');
    expect(qualifyProjectEnvKey('SIDEBOARD_', 'APPLE_ID')).toBe('SIDEBOARD_APPLE_ID');
    expect(qualifyProjectEnvKey('SIDEBOARD_', 'SIDEBOARD_APPLE_ID')).toBe('SIDEBOARD_APPLE_ID');
    expect(qualifyProjectEnvKey('SIDEBOARD_', 'sideboard_APPLE_ID')).toBe('SIDEBOARD_APPLE_ID');
  });

  it('stores project keys under the prefix and account keys unchanged', async () => {
    const repo = join(dataDir, 'sideboard');
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(dataDir, 'workspaces.json'),
      JSON.stringify([{ path: repo, name: 'sideboard', addedAt: '2026-01-01T00:00:00.000Z' }]),
    );
    expect(projectNameForRepoPath(join(repo, 'apps'))).toBe('sideboard');

    const project = setEnvVar({
      key: 'APPLE_ID',
      value: 'me@example.com',
      scope: 'project',
      projectName: 'sideboard',
    });
    expect(project).toMatchObject({
      key: 'SIDEBOARD_APPLE_ID',
      scope: 'project',
      prefix: 'SIDEBOARD_',
      project: 'sideboard',
    });
    setEnvVar({ key: 'CURSOR_API_KEY', value: 'cursor_test', scope: 'account' });

    expect(listEnvKeys()).toEqual([
      { key: 'CURSOR_API_KEY', scope: 'account' },
      {
        key: 'SIDEBOARD_APPLE_ID',
        scope: 'project',
        project: 'sideboard',
        prefix: 'SIDEBOARD_',
      },
    ]);
    expect(classifyEnvKey('CURSOR_API_KEY')).toEqual({ scope: 'account' });

    const removed = deleteEnvVar({
      key: 'APPLE_ID',
      scope: 'project',
      projectName: 'sideboard',
    });
    expect(removed.deleted).toBe(true);
    expect(removed.key).toBe('SIDEBOARD_APPLE_ID');
    expect(listEnvKeys().map((row) => row.key)).toEqual(['CURSOR_API_KEY']);
  });

  it('does not keep an empty value', () => {
    updateAppEnvironment({ KEEP: 'yes' });
    setEnvVar({ key: 'KEEP', value: '  ', scope: 'account' });
    expect(listEnvKeys()).toEqual([]);
  });

  it('tells the agent the project prefix', () => {
    expect(formatEnvDirective('sideboard')).toContain('SIDEBOARD_');
    expect(formatEnvDirective('sideboard')).toContain('SIDEBOARD_APPLE_ID');
    expect(formatEnvReminder('sideboard')).toContain('scope=project stores SIDEBOARD_<NAME>');
    expect(formatEnvDirective(null)).toContain('scope=account');
  });
});
