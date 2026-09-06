import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readViewerContext,
  updateDefaultsSettings,
  updateProjectProfileSettings,
  writeViewerContext,
} from '../store/app-settings.js';
import { matchRegisteredWorkspace } from './viewer-context-tools.js';

describe('viewer context read/write', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-viewer-ctx-'));
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

  it('rejects writes until confirmed, then persists account context', () => {
    const denied = writeViewerContext({
      scope: 'account',
      context: 'Engineering; assignee=me',
      confirmed: false,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe('Confirmation required');
      expect(denied.proposed).toBe('Engineering; assignee=me');
      expect(denied.message).toMatch(/ask_user/);
    }
    expect(readViewerContext().account).toBe('');

    const saved = writeViewerContext({
      scope: 'account',
      context: 'Engineering; assignee=me',
      confirmed: true,
    });
    expect(saved).toEqual({
      ok: true,
      scope: 'account',
      context: 'Engineering; assignee=me',
    });
    expect(readViewerContext().account).toBe('Engineering; assignee=me');
  });

  it('writes project context after confirm and stacks it on account', () => {
    updateDefaultsSettings({ notes: 'Account: assignee=me' });
    const denied = writeViewerContext({
      scope: 'project',
      context: 'design-review only',
      repoPath: '/Users/me/design-app',
      confirmed: false,
    });
    expect(denied.ok).toBe(false);
    expect(readViewerContext('/Users/me/design-app').project).toBe('');

    const saved = writeViewerContext({
      scope: 'project',
      context: 'design-review only',
      repoPath: '/Users/me/design-app',
      confirmed: true,
    });
    expect(saved.ok).toBe(true);
    const read = readViewerContext('/Users/me/design-app');
    expect(read.account).toBe('Account: assignee=me');
    expect(read.project).toBe('design-review only');
    expect(read.combined).toBe('Account: assignee=me\ndesign-review only');
  });

  it('clears project context with an empty confirmed write', () => {
    updateProjectProfileSettings('/Users/me/design-app', {
      notes: 'design-review',
    });
    writeViewerContext({
      scope: 'project',
      context: '',
      repoPath: '/Users/me/design-app',
      confirmed: true,
    });
    expect(readViewerContext('/Users/me/design-app').project).toBe('');
  });

  it('maps worktree paths to a registered workspace and ignores the synthetic home', () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'workspaces.json'),
      JSON.stringify([
        {
          path: '/Users/me/design-app',
          name: 'design-app',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
    expect(matchRegisteredWorkspace('/Users/me/design-app')).toBe(
      '/Users/me/design-app',
    );
    expect(
      matchRegisteredWorkspace('/Users/me/design-app/worktrees/foo'),
    ).toBe('/Users/me/design-app');
    expect(matchRegisteredWorkspace(dataDir)).toBeNull();
    expect(matchRegisteredWorkspace('')).toBeNull();
  });
});
