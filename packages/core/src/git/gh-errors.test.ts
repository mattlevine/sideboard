import { describe, expect, it } from 'vitest';
import {
  extractGhErrorDetail,
  formatGhLandError,
  formatIpcInvokeError,
  formatMergePrError,
  formatRateLimitResetHint,
  isGhRateLimitError,
  isPrNotMergeableError,
} from './gh-errors.js';

describe('isGhRateLimitError', () => {
  it('matches GraphQL rate limit copy from gh', () => {
    expect(
      isGhRateLimitError('GraphQL: API rate limit already exceeded for user ID 836225.'),
    ).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isGhRateLimitError('pull request already exists')).toBe(false);
  });
});

describe('formatRateLimitResetHint', () => {
  it('formats minutes', () => {
    const now = 1_000_000;
    expect(formatRateLimitResetHint(Math.floor(now / 1000) + 600, now)).toBe(
      'in about 10 minutes',
    );
  });
});

describe('extractGhErrorDetail', () => {
  it('keeps the GraphQL trailer from a long execa message', () => {
    const raw =
      "Command failed with exit code 1: gh pr create --title 'x' --body 'huge body'\nGraphQL: API rate limit already exceeded for user ID 836225.";
    expect(extractGhErrorDetail(raw)).toBe(
      'GraphQL: API rate limit already exceeded for user ID 836225.',
    );
  });
});

describe('formatGhLandError', () => {
  it('returns a human-readable rate limit notice with reset hint', () => {
    const now = Date.parse('2026-08-07T04:17:00.000Z');
    const resetAt = Math.floor(Date.parse('2026-08-07T04:27:00.000Z') / 1000);
    const msg = formatGhLandError(
      'GraphQL: API rate limit already exceeded for user ID 836225.',
      { resetAt, nowMs: now },
    );
    expect(msg).toBe(
      'GitHub API rate limit exceeded. Your branch was already pushed. Try again in about 10 minutes. Or create the pull request in the browser (Push & open on GitHub).',
    );
  });

  it('falls back without reset time', () => {
    expect(
      formatGhLandError('GraphQL: API rate limit already exceeded for user ID 1.'),
    ).toContain('Wait a few minutes and try again.');
  });

  it('passes through non-rate-limit detail', () => {
    expect(formatGhLandError('GraphQL: Head sha already exists')).toBe(
      'GraphQL: Head sha already exists',
    );
  });

  it('explains missing head when Sideboard already targeted a repo', () => {
    const msg = formatGhLandError(
      "GraphQL: Head sha can't be blank, No commits between main and x, Head ref must be a branch",
      { targetedRepo: 'mattlevine/storycycle-ai', headRef: 'mattlevine:x' },
    );
    expect(msg).toContain('mattlevine/storycycle-ai');
    expect(msg).toContain('mattlevine:x');
    expect(msg).not.toContain('retry after updating Sideboard');
  });

  it('preserves an already-humanized rate limit notice', () => {
    const human =
      'GitHub API rate limit exceeded. Your branch was already pushed. Try again in about 10 minutes. Or create the pull request in the browser (Push & open on GitHub).';
    expect(formatGhLandError(human)).toBe(human);
  });
});

describe('formatIpcInvokeError', () => {
  it('strips Electron invoke wrapper and humanizes rate limits', () => {
    const err = new Error(
      "Error invoking remote method 'confirmLand': ExecaError: Command failed with exit code 1: gh pr create --body '…'\nGraphQL: API rate limit already exceeded for user ID 836225.",
    );
    expect(formatIpcInvokeError(err)).toContain('GitHub API rate limit exceeded.');
    expect(formatIpcInvokeError(err)).not.toContain('Error invoking remote method');
    expect(formatIpcInvokeError(err)).not.toContain('gh pr create');
  });

  it('humanizes merge-not-clean IPC errors', () => {
    const err = new Error(
      "Error invoking remote method 'mergePr': Error: X Pull request mattlevine/sideboard#17 is not mergeable: the merge commit cannot be cleanly created. To have the pull request merged after all the requirements have been met, add the `--auto` flag.",
    );
    const msg = formatIpcInvokeError(err);
    expect(msg).toContain('cannot merge cleanly');
    expect(msg).not.toContain('--auto');
    expect(msg).not.toContain('Error invoking remote method');
    expect(isPrNotMergeableError(msg)).toBe(true);
  });
});

describe('formatMergePrError', () => {
  it('drops the gh --auto hint', () => {
    expect(
      formatMergePrError(
        'X Pull request acme/widgets#1 is not mergeable: the merge commit cannot be cleanly created. To have the pull request merged after all the requirements have been met, add the `--auto` flag.',
      ),
    ).toBe(
      'This pull request cannot merge cleanly into the base branch. Resolve conflicts or update the branch, then retry.',
    );
  });
});
