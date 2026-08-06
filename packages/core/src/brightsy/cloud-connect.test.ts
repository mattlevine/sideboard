import { describe, expect, it } from 'vitest';
import {
  CLOUD_COORDINATOR_BUSY_REPLY,
  CLOUD_COORDINATOR_TIMEOUT_REPLY,
  CLOUD_ORCHESTRATOR_GOAL,
  coordinatorSystemPrompt,
  formatWorkspaceInventory,
} from './cloud-connect.js';

describe('cloud-connect prompts', () => {
  it('re-exports workspace inventory formatter', () => {
    expect(formatWorkspaceInventory([])).toBe('(no registered workspaces)');
    expect(
      formatWorkspaceInventory([
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'brightsy-ai',
          path: '/Users/me/brightsy-ai',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(
      [
        '- sideboard: /Users/me/sideboard',
        '- brightsy-ai: /Users/me/brightsy-ai',
      ].join('\n'),
    );
  });

  it('includes all workspaces and no home repo in the coordinator system prompt', () => {
    const prompt = coordinatorSystemPrompt({
      goal: CLOUD_ORCHESTRATOR_GOAL,
      parentId: 'parent-1',
      audience: 'cloud',
      workspaces: [
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'storycycle-ai',
          path: '/Users/me/storycycle-ai',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(prompt).toContain('ALL registered workspaces');
    expect(prompt).toContain('list_workspaces');
    expect(prompt).toContain('create_thread');
    expect(prompt).toContain('send_to_thread');
    expect(prompt).toContain('no git home directory');
    expect(prompt).toContain('- sideboard: /Users/me/sideboard');
    expect(prompt).toContain('- storycycle-ai: /Users/me/storycycle-ai');
    expect(prompt).not.toContain('Coordinator home repo');
    expect(prompt).toContain('parent-1');
  });

  it('exports fixed busy and timeout replies for cloud agents', () => {
    expect(CLOUD_COORDINATOR_BUSY_REPLY).toContain('busy');
    expect(CLOUD_COORDINATOR_BUSY_REPLY).toContain('What do you want');
    expect(CLOUD_COORDINATOR_TIMEOUT_REPLY).toContain('timed out');
  });
});
