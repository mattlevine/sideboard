import { describe, expect, it } from 'vitest';
import type { AbleTimeTask } from '../integrations/abletime.js';
import type { GitHubIssue } from '../integrations/github-issues.js';
import type { LinearIssue } from '../integrations/linear.js';
import {
  formatAbleTimeTaskPayload,
  formatGitHubIssuePayload,
  formatLinearIssuePayload,
} from './issue-payload.js';
import { CRUSH_BODY_MIN_CHARS } from './smart-crush.js';

function linearIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'iss-1',
    identifier: 'ENG-9',
    title: 'Fix login',
    url: 'https://linear.app/acme/issue/ENG-9',
    description: 'Open settings.',
    labels: ['bug'],
    children: [],
    relations: [],
    comments: [{ id: 'c1', body: 'Looks good' }],
    attachments: [],
    team: {
      id: 't1',
      key: 'ENG',
      name: 'Engineering',
      states: [
        { id: 's1', name: 'Todo', type: 'unstarted' },
        { id: 's2', name: 'Done', type: 'completed' },
      ],
    },
    ...overrides,
  };
}

describe('formatLinearIssuePayload', () => {
  it('passes a small ticket through and drops team.states', () => {
    const out = formatLinearIssuePayload(linearIssue());
    expect(out.description).toBe('Open settings.');
    expect(out.comments).toEqual([{ id: 'c1', body: 'Looks good' }]);
    expect('crush' in out && out.crush).toBeFalsy();
    expect(out.team).toEqual({ id: 't1', key: 'ENG', name: 'Engineering' });
    expect(out.team && 'states' in out.team).toBe(false);
  });

  it('include=full keeps team.states and a huge body', () => {
    const description = Array.from(
      { length: 16 },
      (_, i) => `section ${i} ${'x'.repeat(900)}`,
    ).join('\n\n');
    const issue = linearIssue({ description });
    const full = formatLinearIssuePayload(issue, 'full');
    expect(full).toBe(issue);
    expect(full.team?.states).toHaveLength(2);

    const crushed = formatLinearIssuePayload(issue);
    expect(crushed).not.toBe(issue);
    expect('crush' in crushed && crushed.crush?.body?.originalChars).toBe(description.length);
  });

  it('dedups bot comments and reports crush.comments', () => {
    const spam = 'Greptile finished this review. '.repeat(30);
    const issue = linearIssue({
      comments: Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, body: spam })),
    });
    const out = formatLinearIssuePayload(issue);
    expect(out.comments).toHaveLength(1);
    expect('crush' in out && out.crush?.comments).toMatchObject({
      kept: 1,
      dropped: 7,
      reason: 'dedup',
    });
  });
});

describe('formatGitHubIssuePayload', () => {
  it('include=full is identity; default crushes a huge body', () => {
    const body = Array.from({ length: 16 }, (_, i) => `paragraph ${i} ${'n'.repeat(900)}`).join(
      '\n\n',
    );
    const issue: GitHubIssue = {
      id: 'gh-12',
      identifier: '#12',
      number: 12,
      title: 'Bug',
      url: 'https://github.com/acme/app/issues/12',
      body,
      labels: [],
      assignees: [],
      comments: [],
    };
    expect(formatGitHubIssuePayload(issue, 'full')).toBe(issue);
    const crushed = formatGitHubIssuePayload(issue);
    expect(crushed.body).not.toBe(body);
    expect(crushed.body).toContain('include=full');
  });
});

describe('formatAbleTimeTaskPayload', () => {
  it('keeps the slim IssueInfo fields plus crushed comments', () => {
    const task: AbleTimeTask = {
      id: '1',
      identifier: 'CRM-232',
      title: 'Call',
      url: 'https://track.abletime.com/1',
      labels: [],
      comments: [{ body: 'Pinged the customer' }],
      description: 'Follow up',
      state: 'open',
      assignee: { name: 'Ada' },
    };
    const out = formatAbleTimeTaskPayload(task);
    expect(out).toMatchObject({
      identifier: 'CRM-232',
      provider: 'abletime',
      assignee: 'Ada',
      description: 'Follow up',
      state: 'open',
    });
    expect('crush' in out && out.crush).toBeFalsy();
  });
});
