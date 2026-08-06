import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import { FAMOUS_SOCCER_TEAMS } from '../git/teams.js';
import {
  createGlobalChat,
  ensureCloudCoordinator,
  GLOBAL_WORKSPACE_ID,
  healOrchestrationSoccerTitles,
  isGlobalThread,
  listGlobalThreads,
  orchestratorSessionPoisonedByBuiltins,
} from './global-workspace.js';
import { updateThread } from './thread-store.js';

const teamNames = new Set(FAMOUS_SOCCER_TEAMS.map((t) => t.name));

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
    expect(chat.title).toBe('Ship the feature');
    expect(isGlobalThread(chat)).toBe(true);
    expect(listGlobalThreads()).toHaveLength(1);
  });

  it('defaults orchestration chat titles to a soccer team nickname', () => {
    const chat = createGlobalChat({
      agent: 'claude',
      sourceRef: 'Coordinate the fleet release',
    });
    expect(teamNames.has(chat.title)).toBe(true);
    expect(chat.sourceRef).toBe('Coordinate the fleet release');
    expect(chat.userSetTitle).toBe(true);
  });

  it('ensureCloudCoordinator is a singleton under Global with a soccer nickname', () => {
    const cloud = ensureCloudCoordinator('claude');
    expect(cloud.sourceRef).toBe(CLOUD_ORCHESTRATOR_GOAL);
    expect(teamNames.has(cloud.title)).toBe(true);
    expect(cloud.title).not.toBe(CLOUD_ORCHESTRATOR_GOAL);
    expect(cloud.repoPath).toBe(GLOBAL_WORKSPACE_ID);
    const again = ensureCloudCoordinator('codex');
    expect(again.id).toBe(cloud.id);
  });

  it('heals legacy cloud-goal titles to soccer nicknames', () => {
    const cloud = ensureCloudCoordinator('claude');
    // Simulate pre-nickname cloud title.
    updateThread(cloud.id, { title: CLOUD_ORCHESTRATOR_GOAL });
    expect(healOrchestrationSoccerTitles()).toBe(1);
    const healed = listGlobalThreads().find((t) => t.id === cloud.id)!;
    expect(teamNames.has(healed.title)).toBe(true);
    expect(healed.sourceRef).toBe(CLOUD_ORCHESTRATOR_GOAL);
  });

  it('detects sessions that used Bash without Sideboard MCP (wrong identity)', () => {
    expect(
      orchestratorSessionPoisonedByBuiltins({
        messages: [
          {
            role: 'agent',
            text: 'empty',
            parts: [{ type: 'tool', id: '1', name: 'Bash', input: {}, status: 'done' }],
            ts: new Date().toISOString(),
          },
        ],
      }),
    ).toBe(true);
    expect(
      orchestratorSessionPoisonedByBuiltins({
        messages: [
          {
            role: 'agent',
            text: 'ok',
            parts: [
              {
                type: 'tool',
                id: '1',
                name: 'mcp__sideboard__list_threads',
                input: {},
                status: 'done',
              },
              { type: 'tool', id: '2', name: 'Bash', input: {}, status: 'done' },
            ],
            ts: new Date().toISOString(),
          },
        ],
      }),
    ).toBe(false);
  });
});
