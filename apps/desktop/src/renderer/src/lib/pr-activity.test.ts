import { describe, expect, it } from 'vitest';
import type { PrDetails } from '@sideboard-ai/core';
import {
  githubPullNumber,
  htmlFragmentsToMarkdown,
  prActivityItems,
  prDetailsAttachment,
  prTabTitle,
  preparePrCommentBody,
  relativePrTime,
  reviewStateLabel,
  rewriteDeadBadgeUrl,
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
});
