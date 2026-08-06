import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import {
  createGlobalChat,
  ensureCloudCoordinator,
  GLOBAL_WORKSPACE_ID,
  isGlobalThread,
  listGlobalThreads,
} from './global-workspace.js';

describe('global-workspace', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-global-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a home-less global chat with sentinel repoPath', () => {
    const chat = createGlobalChat({
      title: 'Ship the feature',
      agent: 'claude',
      sourceRef: 'Ship the feature',
    });
    expect(chat.repoPath).toBe(GLOBAL_WORKSPACE_ID);
    expect(chat.sourceType).toBe('orchestration');
    expect(chat.branchName).toBe('global');
    expect(chat.worktreePath).toBe(join(dataDir, 'global'));
    expect(isGlobalThread(chat)).toBe(true);
    expect(listGlobalThreads()).toHaveLength(1);
  });

  it('ensureCloudCoordinator is a singleton under Global', () => {
    const cloud = ensureCloudCoordinator('claude');
    expect(cloud.sourceRef).toBe(CLOUD_ORCHESTRATOR_GOAL);
    expect(cloud.repoPath).toBe(GLOBAL_WORKSPACE_ID);
    const again = ensureCloudCoordinator('codex');
    expect(again.id).toBe(cloud.id);
  });
});
