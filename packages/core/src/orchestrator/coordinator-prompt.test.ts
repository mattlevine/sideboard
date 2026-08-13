import { describe, expect, it } from 'vitest';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  coordinatorSystemPrompt,
  coordinatorTurnReminder,
  ensureGlobalCoordinatorCwd,
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
    expect(prompt).toContain('orchestration agent');
    expect(prompt).toContain('list_workspaces');
    expect(prompt).toContain('list_branches');
    expect(prompt).toContain('list_prs');
    expect(prompt).toContain('list_issues');
    expect(prompt).toContain('create_thread');
    expect(prompt).toContain('Account defaults');
    expect(prompt).toContain('list_models');
    expect(prompt).toContain('set_caffeinate');
    expect(prompt).toContain('fork_worktree');
    expect(prompt).toContain('fork_chat');
    expect(prompt).toMatch(/orchestration chat/i);
    expect(prompt).toContain('send_to_thread');
    expect(prompt).toContain('wait_for_turn');
    expect(prompt).toContain('stop_thread');
    expect(prompt).toContain('force-stop');
    expect(prompt).toContain('force_stop');
    expect(prompt).toContain('archive_thread');
    expect(prompt).toContain('restore_thread');
    expect(prompt).toContain('run_setup');
    expect(prompt).toContain('run_dev_script');
    expect(prompt).toContain('get_diff');
    expect(prompt).toContain('request_review');
    expect(prompt).not.toContain('create_draft_pr');
    expect(prompt).not.toContain('preview_land');
    expect(prompt).toContain('purge_thread');
    expect(prompt).toContain('parent-1');
    expect(prompt).toContain('github:acme/sideboard');
    expect(prompt).toContain('Ask the worktree agent');
    expect(prompt).toContain('gh pr create --draft -R');
    expect(prompt).toMatch(/never upstream/i);
    expect(prompt).toContain('Greenfield');
    expect(prompt).toContain('add_workspace');
    expect(prompt).toContain('sideboard/repos');
    expect(prompt).toContain('sideboard://thread/');
  });

  it('slack audience tells the coordinator not to sign the destination name', () => {
    const prompt = coordinatorSystemPrompt({
      goal: 'Ship the feature',
      parentId: 'parent-1',
      audience: 'slack',
      workspaces: [],
    });
    expect(prompt).toContain('Slack DM or @mention');
    expect(prompt).toContain('Do not prefix that name yourself');
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
    expect(prompt).toContain('synthetic and empty on purpose');
    expect(prompt).not.toContain('Coordinator home repo');
  });

  it('turn reminder asserts fleet-oversight role every turn', () => {
    const text = coordinatorTurnReminder({
      parentId: 'abc-123',
      goal: 'Cloud-connected Sideboard orchestrator',
    });
    expect(text).toContain('oversee Sideboard worktree agents');
    expect(text).toContain('not yourself checked out');
    expect(text).toContain('abc-123');
    expect(text).toContain('YOUR orchestration thread id');
    expect(text).toContain('parentThreadId="abc-123"');
    expect(text).toContain('synthetic');
    expect(text).toContain('list_threads');
    expect(text).toContain('Emptiness here is expected');
    expect(text).toContain('New repo');
    expect(text).toContain('add_workspace');
    expect(text).toContain('sideboard://thread/');
    expect(text).toContain('set_caffeinate');
  });

  it('writes CLAUDE.md and AGENTS.md into the global cwd', () => {
    const prev = process.env.SIDEBOARD_APP_DATA;
    const root = mkdtempSync(join(tmpdir(), 'sb-global-cwd-'));
    process.env.SIDEBOARD_APP_DATA = root;
    try {
      const cwd = ensureGlobalCoordinatorCwd({
        orchestratorThreadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      });
      const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
      const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      expect(claude).toContain('Orchestration');
      expect(claude).toContain('create_thread');
      expect(claude).toContain('oversee worktree agents');
      expect(claude).toContain('normal');
      expect(claude).toContain('Greenfield');
      expect(claude).toContain('add_workspace');
      expect(claude).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(claude).toContain('parentThreadId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"');
      expect(agents).toContain('Sideboard MCP');
      expect(agents).toContain('set_caffeinate');
      expect(agents).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

      // reconcile-style rewrite without an id must keep the prior uuid
      ensureGlobalCoordinatorCwd();
      const agents2 = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      expect(agents2).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    } finally {
      if (prev === undefined) delete process.env.SIDEBOARD_APP_DATA;
      else process.env.SIDEBOARD_APP_DATA = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
