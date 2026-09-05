import { describe, expect, it } from 'vitest';
import type { PrInfo } from '../types/thread.js';
import { compactPrRow, formatMcpPrList } from './pr-list.js';
import { mcpJson } from './issue-list.js';

function pr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 12,
    title: 'Add login',
    headRefName: 'feat/login',
    url: 'https://github.com/acme/app/pull/12',
    isCrossRepository: false,
    author: { login: 'sam' },
    state: 'OPEN',
    labels: ['eng-review'],
    reviewers: ['alex'],
    tickets: ['ENG-12'],
    ...overrides,
  };
}

describe('mcp pr-list', () => {
  it('omits empty list fields and pretty-print whitespace', () => {
    const row = compactPrRow(
      pr({
        labels: [],
        reviewers: [],
        tickets: [],
        author: null,
        state: undefined,
        headRefName: '',
      }),
    );
    expect(row).toEqual({ number: 12, title: 'Add login' });
    expect(JSON.stringify(row)).not.toContain('\n');

    const listed = formatMcpPrList({
      state: 'open',
      labels: ['eng-review'],
      reviewer: 'unassigned',
      limit: 40,
      truncated: true,
      prs: [pr({ reviewers: undefined, labels: ['eng-review'] })],
    });
    expect(listed.truncated).toBe(true);
    expect(listed.hint).toMatch(/max 250/);
    expect(listed.prs[0]).toMatchObject({
      number: 12,
      labels: ['eng-review'],
      author: 'sam',
      tickets: ['ENG-12'],
    });
    expect(listed.prs[0]).not.toHaveProperty('url');
    expect(mcpJson(listed).content[0]?.text).not.toContain('\n');
  });
});
