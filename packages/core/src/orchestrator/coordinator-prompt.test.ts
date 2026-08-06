import { describe, expect, it } from 'vitest';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import {
  coordinatorSystemPrompt,
  formatWorkspaceInventory,
} from './coordinator-prompt.js';

describe('coordinator-prompt', () => {
  it('formats workspace inventory with optional github slug', () => {
    expect(formatWorkspaceInventory([])).toBe('(no registered workspaces)');
    expect(
      formatWorkspaceInventory([
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
          githubSlug: 'acme/sideboard',
        },
        {
          name: 'brightsy-ai',
          path: '/Users/me/brightsy-ai',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(
      [
        '- sideboard: /Users/me/sideboard  github:acme/sideboard',
        '- brightsy-ai: /Users/me/brightsy-ai',
      ].join('\n'),
    );
  });

  it('desktop playbook covers create/chat/stop/archive and discovery tools', () => {
    const prompt = coordinatorSystemPrompt({
      goal: 'Ship the feature',
      parentId: 'parent-1',
      audience: 'desktop',
      workspaces: [
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
          githubSlug: 'acme/sideboard',
        },
      ],
    });
    expect(prompt).toContain('global orchestrator');
    expect(prompt).toContain('list_workspaces');
    expect(prompt).toContain('list_branches');
    expect(prompt).toContain('list_prs');
    expect(prompt).toContain('list_issues');
    expect(prompt).toContain('create_thread');
    expect(prompt).toContain('send_to_thread');
    expect(prompt).toContain('wait_for_turn');
    expect(prompt).toContain('stop_thread');
    expect(prompt).toContain('archive_thread');
    expect(prompt).toContain('restore_thread');
    expect(prompt).toContain('run_setup');
    expect(prompt).toContain('run_dev_script');
    expect(prompt).toContain('confirm_land');
    expect(prompt).toContain('purge_thread');
    expect(prompt).toContain('parent-1');
    expect(prompt).toContain('github:acme/sideboard');
    expect(prompt).toContain('create_thread → send_to_thread → wait_for_turn');
  });

  it('cloud audience keeps Brightsy reply framing', () => {
    const prompt = coordinatorSystemPrompt({
      goal: CLOUD_ORCHESTRATOR_GOAL,
      parentId: 'parent-1',
      audience: 'cloud',
      workspaces: [],
    });
    expect(prompt).toContain('Brightsy cloud agent');
    expect(prompt).toContain('ALL registered workspaces');
    expect(prompt).toContain('no git home directory');
    expect(prompt).not.toContain('Coordinator home repo');
  });
});
