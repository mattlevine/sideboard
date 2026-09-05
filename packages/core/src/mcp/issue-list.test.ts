import { describe, expect, it } from 'vitest';
import type { IssueInfo } from '../types/thread.js';
import {
  MCP_ISSUE_LIST_DEFAULT_LIMIT,
  applyIssueListWindow,
  clampMcpIssueLimit,
  compactIssueRow,
  formatMcpIssueList,
  mcpJson,
} from './issue-list.js';

function issue(overrides: Partial<IssueInfo> = {}): IssueInfo {
  return {
    id: 'gh-1',
    identifier: '#1',
    title: 'Fix login',
    url: 'https://github.com/acme/app/issues/1',
    labels: ['bug'],
    provider: 'github',
    assignee: 'octocat',
    assignees: ['octocat'],
    ...overrides,
  };
}

describe('mcp issue-list', () => {
  it('defaults and clamps MCP list limits', () => {
    expect(clampMcpIssueLimit()).toBe(MCP_ISSUE_LIST_DEFAULT_LIMIT);
    expect(clampMcpIssueLimit(Number.NaN)).toBe(40);
    expect(clampMcpIssueLimit(0)).toBe(1);
    expect(clampMcpIssueLimit(100)).toBe(100);
    expect(clampMcpIssueLimit(999)).toBe(250);
  });

  it('windows a fetched page so callers can detect truncation', () => {
    expect(applyIssueListWindow(['a', 'b', 'c'], 2)).toEqual({
      items: ['a', 'b'],
      truncated: true,
    });
    expect(applyIssueListWindow(['a', 'b'], 2)).toEqual({
      items: ['a', 'b'],
      truncated: false,
    });
  });

  it('omits empty list fields and pretty-print whitespace', () => {
    const row = compactIssueRow(
      issue({
        labels: [],
        assignee: undefined,
        assignees: undefined,
        teamKey: 'ENG',
        cycle: { name: 'Week 34', isActive: true },
      }),
    );
    expect(row).toEqual({
      identifier: '#1',
      title: 'Fix login',
      team: 'ENG',
      cycle: 'Week 34',
    });
    expect(JSON.stringify(row)).not.toContain('\n');

    const listed = formatMcpIssueList({
      source: 'linear',
      viewer: 'Matt',
      limit: 40,
      truncated: true,
      issues: [issue({ identifier: 'ENG-2', title: 'Inbox', teamKey: 'ENG' })],
    });
    expect(listed.truncated).toBe(true);
    expect(listed.hint).toMatch(/max 250/);
    expect(listed.issues[0]).toMatchObject({ identifier: 'ENG-2', team: 'ENG' });
    expect(listed.issues[0]).not.toHaveProperty('url');
    expect(mcpJson(listed).content[0]?.text).not.toContain('\n');
  });
});
