import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import { FAMOUS_SOCCER_TEAMS } from '../git/teams.js';
import {
  createGlobalChat,
  ensureCloudCoordinator,
  ensureSlackCoordinator,
  GLOBAL_WORKSPACE_ID,
  healOrchestrationSoccerTitles,
  isGlobalThread,
  isSlackCoordinatorThread,
  listGlobalThreads,
  orchestratorSessionPoisonedByBuiltins,
  slackCoordinatorSourceRef,
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

  it('persists orchestration modal image drops into the global cwd', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chat = createGlobalChat({
      agent: 'claude',
      sourceRef: 'Look at this screenshot',
      attachments: [
        {
          id: 'shot',
          name: 'Screenshot.png',
          kind: 'file',
          previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
          content:
            'Image attached: Screenshot.png\nThe image is shown in the composer; copy it into the worktree if you need to inspect pixels.',
        },
      ],
    });
    expect(chat.attachments[0]?.path).toBe('.context/attachments/Screenshot.png');
    expect(
      existsSync(join(chat.worktreePath, '.context', 'attachments', 'Screenshot.png')),
    ).toBe(true);
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

  it('rejects Brightsy as a Global orchestrator agent', () => {
    expect(() =>
      createGlobalChat({
        agent: 'brightsy',
        sourceRef: 'Should fail',
      }),
    ).toThrow(/does not support Sideboard MCP/);
  });

  it('ensureCloudCoordinator applies account default model on create', async () => {
    const { updateDefaultsSettings } = await import('./app-settings.js');
    updateDefaultsSettings({ agent: 'cursor', model: 'default', effort: 'xhigh' });
    const cloud = ensureCloudCoordinator('cursor');
    expect(cloud.agent).toBe('cursor');
    expect(cloud.model).toBe('default');
    expect(cloud.effort).toBe('xhigh');
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

  it('ensureSlackCoordinator is one Global chat per Slack user', () => {
    const matt = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    expect(matt.sourceRef).toBe(slackCoordinatorSourceRef('T1', 'Umatt'));
    expect(isSlackCoordinatorThread(matt)).toBe(true);
    expect(matt.repoPath).toBe(GLOBAL_WORKSPACE_ID);
    expect(teamNames.has(matt.title)).toBe(true);

    const mattAgain = ensureSlackCoordinator('T1', 'Umatt', 'codex');
    expect(mattAgain.id).toBe(matt.id);

    const alice = ensureSlackCoordinator('T1', 'Ualice', 'claude');
    expect(alice.id).not.toBe(matt.id);
    expect(alice.sourceRef).toBe('slack:T1:Ualice');

    const otherTeam = ensureSlackCoordinator('T2', 'Umatt', 'claude');
    expect(otherTeam.id).not.toBe(matt.id);

    // Brightsy cloud singleton stays separate.
    const cloud = ensureCloudCoordinator('claude');
    expect(cloud.id).not.toBe(matt.id);
  });

  it('ensureSlackCoordinator creates a new chat after the previous one is archived', () => {
    const matt = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    updateThread(matt.id, { status: 'archived' });
    const afterArchive = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    expect(afterArchive.id).not.toBe(matt.id);
    expect(afterArchive.sourceRef).toBe(slackCoordinatorSourceRef('T1', 'Umatt'));
    expect(afterArchive.status).not.toBe('archived');
  });

  it('ensureSlackCoordinator forceNew opens a replacement even if one is still live', () => {
    const matt = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    const replacement = ensureSlackCoordinator('T1', 'Umatt', 'claude', { forceNew: true });
    expect(replacement.id).not.toBe(matt.id);
    expect(replacement.sourceRef).toBe(slackCoordinatorSourceRef('T1', 'Umatt'));
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
