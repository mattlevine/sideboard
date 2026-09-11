import { describe, expect, it } from 'vitest';
import {
  ISSUE_SINCE_ERROR,
  formatGitHubSearchUpdatedSince,
  issueActivityKind,
  issueMatchesUpdatedSince,
  parseIssueSince,
  previewIssueCommentBody,
} from './issue-since.js';

const NOW = new Date(2026, 8, 11, 15, 30, 0); // 11 Sep 2026 15:30 local

describe('parseIssueSince', () => {
  it('parses ISO datetimes and date-only local midnight', () => {
    expect(parseIssueSince('2026-09-10T12:00:00.000Z')).toBe('2026-09-10T12:00:00.000Z');
    expect(parseIssueSince('2026-09-10', NOW)).toBe(new Date(2026, 8, 10).toISOString());
  });

  it('parses today, yesterday, and last week as local midnights', () => {
    expect(parseIssueSince('today', NOW)).toBe(new Date(2026, 8, 11).toISOString());
    expect(parseIssueSince('yesterday', NOW)).toBe(new Date(2026, 8, 10).toISOString());
    expect(parseIssueSince('last week', NOW)).toBe(new Date(2026, 8, 4).toISOString());
  });

  it('parses relative hours, days, and weeks', () => {
    expect(parseIssueSince('3 hours ago', NOW)).toBe(new Date(2026, 8, 11, 12, 30, 0).toISOString());
    expect(parseIssueSince('2d', NOW)).toBe(new Date(2026, 8, 9).toISOString());
    expect(parseIssueSince('1 week ago', NOW)).toBe(new Date(2026, 8, 4).toISOString());
  });

  it('rejects empty or unknown input', () => {
    expect(() => parseIssueSince('')).toThrow(ISSUE_SINCE_ERROR);
    expect(() => parseIssueSince('soon')).toThrow(ISSUE_SINCE_ERROR);
    expect(() => parseIssueSince('2026-13-40')).toThrow(ISSUE_SINCE_ERROR);
  });
});

describe('issue since helpers', () => {
  it('matches updated/created timestamps and classifies new vs existing', () => {
    const since = '2026-09-10T00:00:00.000Z';
    expect(issueMatchesUpdatedSince({ updatedAt: '2026-09-10T01:00:00.000Z' }, since)).toBe(true);
    expect(issueMatchesUpdatedSince({ updatedAt: '2026-09-09T23:00:00.000Z' }, since)).toBe(false);
    expect(issueMatchesUpdatedSince({}, since)).toBe(false);
    expect(issueActivityKind({ createdAt: '2026-09-11T00:00:00.000Z' }, since)).toBe('created');
    expect(issueActivityKind({ createdAt: '2026-09-01T00:00:00.000Z' }, since)).toBe('updated');
  });

  it('strips milliseconds for GitHub search tokens', () => {
    expect(formatGitHubSearchUpdatedSince('2026-09-10T07:00:00.000Z')).toBe(
      '2026-09-10T07:00:00Z',
    );
  });

  it('collapses comment previews', () => {
    expect(previewIssueCommentBody('Please\n\nship')).toBe('Please ship');
    expect(previewIssueCommentBody('x'.repeat(300)).endsWith('…')).toBe(true);
    expect(previewIssueCommentBody('x'.repeat(300)).length).toBe(240);
  });
});
