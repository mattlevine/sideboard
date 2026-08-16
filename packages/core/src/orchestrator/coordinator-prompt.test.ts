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
    expect(text).toContain('ask_git');
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
      expect(claude).toContain('add_workspace');
      expect(claude).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(claude).toContain('parentThreadId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"');
      expect(claude).toBe(agents);
      expect(claude).toContain(COORDINATOR_TOOL_PLAYBOOK.slice(0, 80));
      expect(claude).toContain('Typical flow (existing)');
      expect(claude).toContain('force_stop: true');
      expect(claude).toContain('Greenfield');
      expect(claude).toContain('ask_git');
      expect(claude).toContain('set_caffeinate');
      expect(claude).toContain('slack_replies');
      expect(claude).toContain('Sideboard MCP');

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
