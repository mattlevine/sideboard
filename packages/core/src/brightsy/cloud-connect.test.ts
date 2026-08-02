import { describe, expect, it } from 'vitest';
import {
  CLOUD_ORCHESTRATOR_GOAL,
  coordinatorSystemPrompt,
  formatWorkspaceInventory,
} from './cloud-connect.js';

describe('cloud-connect prompts', () => {
  it('formats workspace inventory', () => {
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

  it('includes all workspaces in the coordinator system prompt', () => {
    const prompt = coordinatorSystemPrompt({
      goal: CLOUD_ORCHESTRATOR_GOAL,
      homeRepoPath: '/Users/me/sideboard',
      parentId: 'parent-1',
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
    expect(prompt).toContain('- sideboard: /Users/me/sideboard');
    expect(prompt).toContain('- storycycle-ai: /Users/me/storycycle-ai');
    expect(prompt).toContain('Coordinator home repo: /Users/me/sideboard');
    expect(prompt).toContain('parent-1');
  });
});
