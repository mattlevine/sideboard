import { describe, expect, it, beforeEach } from 'vitest';
import {
  answerToolPermission,
  askToolPermission,
  denyPendingToolPermissions,
  describeToolPermission,
  resetToolPermissionsForTests,
  setToolPermissionPublisher,
  type ToolPermissionPublisher,
} from './tool-permission.js';
import type { AgentPermissionPrompt } from '../types/agent-block.js';

const shown: AgentPermissionPrompt[] = [];

const publisher: ToolPermissionPublisher = {
  show(item) {
    shown.push(item.prompt);
    return true;
  },
  clear() {},
};

beforeEach(() => {
  shown.length = 0;
  resetToolPermissionsForTests();
  setToolPermissionPublisher(publisher);
});

describe('describeToolPermission', () => {
  it('uses the blocked path when Claude names one', () => {
    const described = describeToolPermission({
      threadId: 't1',
      toolName: 'Edit',
      blockedPath: '/Users/me/.claude/skills/review/SKILL.md',
      title: 'Claude wants to edit SKILL.md',
    });
    expect(described.path).toBe('/Users/me/.claude/skills/review/SKILL.md');
    expect(described.title).toBe('Claude wants to edit SKILL.md');
  });

  it('reads a file path from the tool input', () => {
    const described = describeToolPermission({
      threadId: 't1',
      toolName: 'Write',
      input: { file_path: '/Users/me/.claude/skills/local/SKILL.md' },
    });
    expect(described.path).toContain('SKILL.md');
    expect(described.title).toMatch(/Allow Write/);
  });
});

describe('askToolPermission', () => {
  it('resolves when the user allows once', async () => {
    const pending = askToolPermission({
      threadId: 't1',
      toolName: 'Edit',
      blockedPath: '/Users/me/.claude/skills/review/SKILL.md',
    });
    expect(shown).toHaveLength(1);
    expect(answerToolPermission(shown[0]!.id, 'allow')).toBe(true);
    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      decisionClassification: 'user_temporary',
    });
    expect(answerToolPermission(shown[0]!.id, 'allow')).toBe(false);
  });

  it('grants the directory for the session', async () => {
    const pending = askToolPermission({
      threadId: 't1',
      toolName: 'Edit',
      blockedPath: '/Users/me/.claude/skills/review/SKILL.md',
    });
    answerToolPermission(shown[0]!.id, 'allow_session');
    const answer = await pending;
    expect(answer.behavior).toBe('allow');
    expect(answer.decisionClassification).toBe('user_permanent');
    expect(answer.updatedPermissions).toEqual([
      {
        type: 'addDirectories',
        directories: ['/Users/me/.claude/skills/review'],
        destination: 'session',
      },
    ]);
  });

  it('lets a session allow cover the whole MCP server, not one argument list', async () => {
    const pending = askToolPermission({
      threadId: 't1',
      toolName: 'mcp__gmail__search',
      mcpServer: 'gmail',
      suppressAlwaysAllow: true,
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'mcp__gmail__search', ruleContent: '{"q":"today"}' }],
        },
      ],
    });
    expect(shown[0]?.allowSession).toBe(true);
    expect(shown[0]?.sessionLabel).toBe('Allow this MCP');
    answerToolPermission(shown[0]!.id, 'allow_session');
    const answer = await pending;
    expect(answer.decisionClassification).toBe('user_permanent');
    expect(answer.updatedPermissions).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'mcp__gmail' }, { toolName: 'mcp__gmail__*' }],
      },
    ]);
  });

  it('denies prompts still waiting when the turn ends', async () => {
    const pending = askToolPermission({
      threadId: 't1',
      toolName: 'Edit',
      blockedPath: '/tmp/skill.md',
    });
    denyPendingToolPermissions('t1');
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' });
  });
});
