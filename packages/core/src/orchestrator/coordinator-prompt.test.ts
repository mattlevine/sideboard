import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COORDINATOR_TOOL_PLAYBOOK,
  coordinatorSystemPrompt,
  coordinatorTurnReminder,
  ensureGlobalCoordinatorCwd,
  formatWorkspaceInventory,
} from './coordinator-prompt.js';

describe('coordinator-prompt', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-coord-prompt-'));
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

  it('appends project context on workspace inventory lines', async () => {
    const { updateDefaultsSettings, updateProjectProfileSettings } = await import(
      '../store/app-settings.js'
    );
    updateDefaultsSettings({ notes: 'assignee=me' });
    updateProjectProfileSettings('/Users/me/sideboard', {
      notes: 'design-review only',
    });
    expect(
      formatWorkspaceInventory([
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
          githubSlug: 'acme/sideboard',
        },
      ]),
    ).toContain('context:design-review only');
    expect(
      formatWorkspaceInventory([
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
          githubSlug: 'acme/sideboard',
        },
      ]),
    ).toContain('design-review only');
  });

  it('first-turn prompt is audience + inventory, not the fleet playbook', () => {
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
    expect(prompt).toContain('parent-1');
    expect(prompt).toContain('github:acme/sideboard');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).not.toContain('Typical flow (existing)');
    expect(prompt).not.toContain('force_stop: true');
    expect(prompt).not.toContain('Greenfield (new app / new GitHub repo)');
    expect(prompt).not.toContain(COORDINATOR_TOOL_PLAYBOOK.slice(0, 80));
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
    expect(prompt).toContain('Slack mrkdwn');
    expect(prompt).toContain('**bold**');
    expect(prompt).toContain('*text*');
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

  it('turn reminder is a short identity line, not the fleet playbook', () => {
    const text = coordinatorTurnReminder({
      parentId: 'abc-123',
      goal: 'Cloud-connected Sideboard orchestrator',
    });
    expect(text).toContain('oversee worktree agents');
    expect(text).toContain('synthetic empty cwd');
    expect(text).toContain('abc-123');
    expect(text).toContain('YOUR orchestration thread id');
    expect(text).toContain('parentThreadId="abc-123"');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('list_board');
    expect(text).toContain('list_threads');
    expect(text).toContain('sideboard://thread/');
    expect(text).toContain('Merge only if the user asked');
    expect(text).not.toContain('Typical flow (existing)');
    expect(text).not.toContain('force_stop: true');
    expect(text).not.toContain('add_workspace');
    expect(text).not.toContain('set_caffeinate');
    expect(text.length).toBeLessThan(900);
  });

  it('fleet playbook tells coordinators how to read child spend', () => {
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('costUsd');
    expect(COORDINATOR_TOOL_PLAYBOOK).toMatch(/get_thread.*usage/s);
    expect(COORDINATOR_TOOL_PLAYBOOK).toMatch(/get_turn_result.*usage/s);
  });

  it('fleet playbook maps review-inbox asks to list_prs, not tickets', () => {
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('list_prs(queue=review, limit=N)');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('do not use it for that review-inbox ask');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('engineering-team');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('Settings → Agents / Projects context');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('eng-review');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('Find work:');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('update_viewer_context');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('scope=project');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('repoPath from list_workspaces');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('confirmed=true');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('find me work and start it');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('Show the options');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('Do not call Claude Linear MCP');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('flap');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('github_*');
    expect(COORDINATOR_TOOL_PLAYBOOK).toContain('abletime_*');
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
      expect(claude).toContain('add_workspace');
      expect(claude).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(claude).toContain('parentThreadId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"');
      expect(claude).toBe(agents);
      expect(claude).toContain(COORDINATOR_TOOL_PLAYBOOK.slice(0, 80));
      expect(claude).toContain('list_board');
      expect(claude).toContain('start_board_card');
      expect(claude).toContain('Typical flow (Home board)');
      expect(claude).toContain('Typical flow (find work)');
      expect(claude).toContain('show the options');
      expect(claude).toContain('find me work and start it');
      expect(claude).toContain('Never wait on Claude Linear MCP');
      expect(claude).toContain('Typical flow (review inbox)');
      expect(claude).toContain('list_prs(queue=review, limit=N)');
      expect(claude).toContain('force_stop: true');
      expect(claude).toContain('Greenfield');
      expect(claude).toContain('ask_git');
      expect(claude).toContain('get_pr_checks');
      expect(claude).toMatch(/If the user gave a goal/);
      expect(claude).toContain('set_caffeinate');
      expect(claude).toContain('create_schedule');
      expect(claude).toContain('slack_replies');
      expect(claude).toContain('Sideboard MCP');
      expect(claude).toMatch(/Prefer official CLIs/);
      expect(claude).toMatch(/Do not add vendor MCPs/);
      expect(claude).toContain('ask_user');
      expect(claude).toMatch(/status stopped or broken/);
      expect(claude).toContain('.claude/skills/');
      expect(claude).toContain('/long-running');
      expect(claude).toContain('graph-engineering');
      expect(claude).toContain('/graph-engineering');
      expect(claude).toMatch(/Do not use `\.sideboard\/skills\//);
      expect(claude).toContain('only if the user explicitly asked');
      expect(claude).not.toContain('when ready) ask_git merge');

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
