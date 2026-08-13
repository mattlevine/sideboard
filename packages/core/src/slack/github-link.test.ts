import { describe, expect, it } from 'vitest';
import { appendGithubLink, labelGithubUrl } from './github-link.js';

describe('labelGithubUrl', () => {
  it('labels pull requests', () => {
    expect(labelGithubUrl('https://github.com/acme/app/pull/42')).toEqual({
      kind: 'pr',
      label: 'PR #42',
      url: 'https://github.com/acme/app/pull/42',
    });
  });

  it('labels PR review comments', () => {
    expect(
      labelGithubUrl('https://github.com/acme/app/pull/42#discussion_r123'),
    ).toEqual({
      kind: 'comment',
      label: 'PR #42 comment',
      url: 'https://github.com/acme/app/pull/42#discussion_r123',
    });
  });

  it('labels blob permalinks with line numbers', () => {
    expect(
      labelGithubUrl(
        'https://github.com/acme/app/blob/main/src/foo.ts#L12-L14',
      ),
    ).toEqual({
      kind: 'code',
      label: 'foo.ts:12-14',
      url: 'https://github.com/acme/app/blob/main/src/foo.ts#L12-L14',
    });
  });

  it('returns null for non-GitHub URLs', () => {
    expect(labelGithubUrl('https://example.com/x')).toBeNull();
    expect(labelGithubUrl('not a url')).toBeNull();
  });
});

describe('appendGithubLink', () => {
  it('appends a Slack mrkdwn link', () => {
    expect(
      appendGithubLink('Ready for review', 'https://github.com/acme/app/pull/7'),
    ).toBe('Ready for review\n<https://github.com/acme/app/pull/7|PR #7>');
  });

  it('returns the body unchanged when github_url is missing', () => {
    expect(appendGithubLink('hello', undefined)).toBe('hello');
  });
});
