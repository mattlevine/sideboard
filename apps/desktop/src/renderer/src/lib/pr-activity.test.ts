import { describe, expect, it } from 'vitest';
import type { PrDetails } from '@sideboard-ai/core';
import {
  githubPullNumber,
  htmlFragmentsToMarkdown,
  prActivityItems,
  prDetailsAttachment,
  prDetailsReviewerList,
  prTabTitle,
  preparePrCommentBody,
  relativePrTime,
  reviewStateLabel,
  rewriteDeadBadgeUrl,
  stripHtmlComments,
  unwrapIndentedHtml,
} from './pr-activity';

const details = (partial: Partial<PrDetails> = {}): PrDetails => ({
  number: 99,
  title: 'fix resume auth',
  body: 'Harden the resume path.',
  url: 'https://github.com/acme/app/pull/99',
  state: 'MERGED',
  isDraft: false,
  reviewDecision: 'APPROVED',
  author: { login: 'matt' },
  baseRefName: 'main',
  headRefName: 'fix/resume',
  additions: 300,
  deletions: 8,
  changedFiles: 10,
  commits: [],
  comments: [],
  reviews: [],
  assignees: [],
  labels: [],
  reviewRequests: [],
  reviewers: [],
  teams: [],
  checks: [],
  ...partial,
});

describe('prTabTitle', () => {
  it('prefers an explicit number', () => {
    expect(prTabTitle({ number: 99 })).toBe('PR #99');
  });

  it('reads a GitHub PR URL', () => {
    expect(prTabTitle({ prUrl: 'https://github.com/acme/app/pull/12' })).toBe('PR #12');
  });

  it('uses a PR source ref', () => {
    expect(prTabTitle({ sourceType: 'pr', sourceRef: '#7' })).toBe('PR #7');
  });
});

describe('githubPullNumber', () => {
  it('parses /pull/N', () => {
    expect(githubPullNumber('https://github.com/acme/app/pull/99/files')).toBe('99');
    expect(githubPullNumber('not-a-url')).toBeNull();
  });
});

describe('prActivityItems', () => {
  it('merges comments and reviews in chronological order', () => {
    const items = prActivityItems(
      details({
        comments: [
          {
            author: { login: 'github-actions' },
            body: 'Checks passed',
            createdAt: '2026-08-12T10:00:00Z',
          },
        ],
        reviews: [
          {
            author: { login: 'reviewer' },
            state: 'APPROVED',
            body: 'LGTM',
            submittedAt: '2026-08-11T10:00:00Z',
          },
        ],
      }),
    );
    expect(items.map((i) => i.author)).toEqual(['reviewer', 'github-actions']);
    expect(items[0]?.kind).toBe('review');
    expect(items[1]?.kind).toBe('comment');
  });
});

describe('reviewStateLabel', () => {
  it('maps GitHub review states', () => {
    expect(reviewStateLabel('APPROVED')).toBe('Approved');
    expect(reviewStateLabel('CHANGES_REQUESTED')).toBe('Requested changes');
  });
});

describe('relativePrTime', () => {
  it('formats day-scale ages', () => {
    const now = Date.parse('2026-09-02T00:00:00Z');
    expect(relativePrTime('2026-08-12T00:00:00Z', now)).toBe('21d ago');
  });
});

describe('unwrapIndentedHtml', () => {
  it('dedents GitHub-style indented HTML so markdown does not fence it', () => {
    const raw = [
      'The latest updates on your projects.',
      '',
      '    <a href="https://vercel.com/acme/app">',
      '      <img src="https://vercel.com/avatar.png" alt="storycycle-ai" />',
      '    </a>',
    ].join('\n');
    const out = unwrapIndentedHtml(raw);
    expect(out).toContain('<a href="https://vercel.com/acme/app">');
    expect(out).not.toMatch(/^ {4}<a /m);
  });
});

describe('rewriteDeadBadgeUrl', () => {
  it('maps Vercel Request Review dark/light SVGs to the live path', () => {
    expect(rewriteDeadBadgeUrl('https://agents-vade-review.vercel.sh/request-review-dark.svg')).toBe(
      'https://agents-vade-review.vercel.sh/request-review.svg',
    );
    expect(
      rewriteDeadBadgeUrl('https://agents-vade-review.vercel.sh/request-review-light.svg'),
    ).toBe('https://agents-vade-review.vercel.sh/request-review.svg');
  });
});

describe('stripHtmlComments', () => {
  it('removes GitHub bot HTML comments', () => {
    expect(stripHtmlComments('<!-- BUGBOT_REVIEW -->\nHello')).toBe('\nHello');
    expect(stripHtmlComments('Hi\n<!-- BUGBOT_FIX_ALL -->\nBye')).toBe('Hi\n\nBye');
  });
});

describe('htmlFragmentsToMarkdown', () => {
  it('turns Vercel picture badges into markdown images', () => {
    const raw = [
      'The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).',
      '',
      '    <a href="https://vercel.com/acme/app"><img src="https://vercel.com/avatar.png" alt="storycycle-ai" /></a>',
      '    <a href="https://vercel.com/vercel-agent/request-review?owner=acme&repo=app&pr=1" rel="noreferrer">',
      '      <picture>',
      '        <source media="(prefers-color-scheme: dark)" srcset="https://agents-vade-review.vercel.sh/request-review-dark.svg">',
      '        <source media="(prefers-color-scheme: light)" srcset="https://agents-vade-review.vercel.sh/request-review-light.svg">',
      '        <img src="https://agents-vade-review.vercel.sh/request-review-light.svg" alt="Request Review">',
      '      </picture>',
      '    </a>',
    ].join('\n');
    const md = htmlFragmentsToMarkdown(raw);
    expect(md).toContain('[Vercel for GitHub]');
    expect(md).toContain('[![storycycle-ai](https://vercel.com/avatar.png)](https://vercel.com/acme/app)');
    expect(md).toContain(
      '[![Request Review](https://agents-vade-review.vercel.sh/request-review.svg)](https://vercel.com/vercel-agent/request-review?owner=acme&repo=app&pr=1)',
    );
    expect(md).not.toContain('request-review-dark.svg');
    expect(md).not.toContain('<picture');
    expect(md).not.toContain('<a href');
  });
});

describe('preparePrCommentBody', () => {
  it('keeps HTML tables as sanitized HTML', () => {
    const prepared = preparePrCommentBody(
      '    <table><tr><td><a href="https://example.com">cell</a></td></tr></table>',
    );
    expect(prepared.mode).toBe('html');
    if (prepared.mode === 'html') {
      expect(prepared.html).toContain('<table>');
      expect(prepared.html).toContain('https://example.com');
      expect(prepared.html).not.toContain('onclick');
    }
  });

  it('uses markdown for mixed prose + HTML badges', () => {
    const prepared = preparePrCommentBody(
      'Hello\n\n    <a href="https://example.com"><img src="https://example.com/a.png" alt="badge" /></a>',
    );
    expect(prepared).toEqual({
      mode: 'markdown',
      text: 'Hello\n\n[![badge](https://example.com/a.png)](https://example.com)',
    });
  });

  it('hides Bugbot HTML comments that would otherwise render as text', () => {
    const body = [
      '<!-- BUGBOT_REVIEW -->',
      'Cursor Bugbot has reviewed your changes and found 1 potential issue.',
      '',
      '<!-- BUGBOT_FIX_ALL -->',
      '<a href="https://cursor.com/agents?fix=1">Fix in Cursor</a>',
    ].join('\n');
    const prepared = preparePrCommentBody(body);
    expect(prepared.mode).toBe('markdown');
    if (prepared.mode === 'markdown') {
      expect(prepared.text).toContain('Cursor Bugbot has reviewed your changes');
      expect(prepared.text).toContain('[Fix in Cursor](https://cursor.com/agents?fix=1)');
      expect(prepared.text).not.toContain('<!--');
      expect(prepared.text).not.toContain('BUGBOT_REVIEW');
      expect(prepared.text).not.toContain('BUGBOT_FIX_ALL');
    }
  });

  it('strips HTML comments from sanitized table comments', () => {
    const prepared = preparePrCommentBody(
      '<!-- BUGBOT_REVIEW -->\n    <table><tr><td>cell</td></tr></table>',
    );
    expect(prepared.mode).toBe('html');
    if (prepared.mode === 'html') {
      expect(prepared.html).toContain('<table>');
      expect(prepared.html).not.toContain('<!--');
      expect(prepared.html).not.toContain('BUGBOT_REVIEW');
    }
  });

  it('keeps GitHub markdown image-links pointed at the PR', () => {
    const body = [
      'Validation: Unit tests.',
      '',
      '[![Open in Web](https://img.shields.io/badge/Open_in_Web-111.svg)](https://github.com/acme/app)',
      '[![View Automation](https://img.shields.io/badge/View_Automation-111.svg)](https://github.com/acme/app/actions)',
    ].join('\n');
    const prepared = preparePrCommentBody(body);
    expect(prepared.mode).toBe('markdown');
    if (prepared.mode === 'markdown') {
      expect(prepared.text).toContain(
        '[![Open in Web](https://img.shields.io/badge/Open_in_Web-111.svg)](https://github.com/acme/app)',
      );
      expect(prepared.text).toContain(
        '[![View Automation](https://img.shields.io/badge/View_Automation-111.svg)](https://github.com/acme/app/actions)',
      );
    }
  });
});

describe('prDetailsReviewerList', () => {
  it('unions requested reviewers, teams, and submitted reviews', () => {
    expect(
      prDetailsReviewerList(
        details({
          reviewers: ['alice'],
          teams: ['engineering-team'],
          reviewRequests: ['alice', 'copilot'],
          reviews: [
            {
              author: { login: 'bob' },
              state: 'APPROVED',
              body: 'LGTM',
              submittedAt: '2026-08-11T10:00:00Z',
            },
          ],
        }),
      ),
    ).toEqual(['alice', 'engineering-team', 'copilot', 'bob']);
  });
});

describe('prDetailsAttachment', () => {
  it('includes title, description, and activity', () => {
    const att = prDetailsAttachment(
      details({
        comments: [
          {
            author: { login: 'supabase' },
            body: 'Preview ready',
            createdAt: '2026-08-12T10:00:00Z',
          },
        ],
      }),
    );
    expect(att.kind).toBe('issue');
    expect(att.name).toBe('#99');
    expect(att.content).toContain('#99 fix resume auth');
    expect(att.content).toContain('Harden the resume path.');
    expect(att.content).toContain('@supabase');
    expect(att.content).toContain('Preview ready');
  });

  it('includes assignees, reviewers, and labels', () => {
    const att = prDetailsAttachment(
      details({
        assignees: ['matt'],
        reviewers: ['alice'],
        labels: ['eng-review'],
      }),
    );
    expect(att.content).toContain('Assignees: matt');
    expect(att.content).toContain('Reviewers: alice');
    expect(att.content).toContain('Labels: eng-review');
  });
});
