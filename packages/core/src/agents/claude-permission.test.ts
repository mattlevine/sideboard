import { describe, expect, it } from 'vitest';
import { claudePermissionResult } from './claude-permission.js';

describe('claudePermissionResult', () => {
  it('does not ask while plan mode is on', async () => {
    const result = await claudePermissionResult({
      permissionMode: 'plan',
      threadId: 't1',
      toolName: 'Edit',
      toolInput: {},
      options: {},
      call: async () => {
        throw new Error('should not ask');
      },
    });
    expect(result.behavior).toBe('deny');
  });

  it('returns the user allow decision from permission.ask', async () => {
    const result = await claudePermissionResult({
      permissionMode: 'acceptEdits',
      threadId: 't1',
      toolName: 'Edit',
      toolInput: { file_path: '/Users/me/.claude/skills/review/SKILL.md' },
      options: { blockedPath: '/Users/me/.claude/skills/review/SKILL.md', title: 'Edit skill' },
      call: async (method, params) => {
        expect(method).toBe('permission.ask');
        expect(params).toMatchObject({
          threadId: 't1',
          toolName: 'Edit',
          blockedPath: '/Users/me/.claude/skills/review/SKILL.md',
        });
        return { behavior: 'allow', decisionClassification: 'user_temporary' };
      },
    });
    expect(result).toEqual({ behavior: 'allow', decisionClassification: 'user_temporary' });
  });

  it('approves an MCP tool in full autonomy without asking', async () => {
    const result = await claudePermissionResult({
      permissionMode: 'bypassPermissions',
      threadId: 't1',
      toolName: 'mcp__gmail__search',
      toolInput: { q: 'today' },
      options: {},
      call: async () => {
        throw new Error('should not ask');
      },
    });
    expect(result).toEqual({
      behavior: 'allow',
      decisionClassification: 'user_permanent',
      updatedPermissions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'mcp__gmail' }, { toolName: 'mcp__gmail__*' }],
        },
      ],
    });
  });

  it('still asks for a non-MCP tool in full autonomy', async () => {
    const result = await claudePermissionResult({
      permissionMode: 'bypassPermissions',
      threadId: 't1',
      toolName: 'Edit',
      toolInput: {},
      options: {},
      call: async () => ({ behavior: 'allow', decisionClassification: 'user_temporary' }),
    });
    expect(result).toEqual({ behavior: 'allow', decisionClassification: 'user_temporary' });
  });
});
