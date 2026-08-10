import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REPO_REVIEW_PATH,
  REVIEW_REQUEST_PATH,
  REVIEW_REQUEST_PREFILL,
  buildReviewRequestAttachment,
  ensureReviewRequestFile,
  readExistingReviewRequestFile,
  requestReview,
  resolveReviewGuidelines,
} from './request-review.js';

vi.mock('../store/thread-store.js', () => ({
  findThreadByRef: vi.fn(),
}));

vi.mock('../threads/chat-tabs.js', () => ({
  createChatTab: vi.fn(),
}));

import { findThreadByRef } from '../store/thread-store.js';
import { createChatTab } from '../threads/chat-tabs.js';

const findMock = vi.mocked(findThreadByRef);
const createTabMock = vi.mocked(createChatTab);

describe('requestReview', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = join(tmpdir(), `sideboard-review-${Date.now()}`);
    mkdirSync(join(worktree, '.sideboard', 'attachments'), { recursive: true });
    findMock.mockReset();
    createTabMock.mockReset();
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
  });

  it('prefers committed .sideboard/review.md over local attachments', () => {
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '# local only\n');
    mkdirSync(join(worktree, '.sideboard'), { recursive: true });
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '# repo policy\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('repo');
    expect(resolved.path).toBe(REPO_REVIEW_PATH);
    expect(resolved.content).toContain('repo policy');
  });

  it('uses local attachments when repo file is absent', () => {
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '## Recommendation\nlocal\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('local');
    expect(resolved.path).toBe(REVIEW_REQUEST_PATH);
    expect(resolved.content).toContain('local');
  });

  it('seeds stock template into local attachments when nothing exists', () => {
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('stock');
    expect(resolved.path).toBe(REVIEW_REQUEST_PATH);
    expect(existsSync(join(worktree, REVIEW_REQUEST_PATH))).toBe(true);
    expect(existsSync(join(worktree, REPO_REVIEW_PATH))).toBe(false);
    expect(resolved.content).toContain('## Required outcome');
  });

  it('reads existing guidelines preferring repo', () => {
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '# custom repo\n');
    expect(readExistingReviewRequestFile(worktree)).toContain('custom repo');
  });

  it('customize ensures committed .sideboard/review.md when neither exists', () => {
    const ensured = ensureReviewRequestFile(worktree);
    expect(ensured.source).toBe('repo');
    expect(ensured.path).toBe(REPO_REVIEW_PATH);
    expect(existsSync(join(worktree, REPO_REVIEW_PATH))).toBe(true);
  });

  it('rejects orchestrator threads', async () => {
    findMock.mockReturnValue({
      id: 'orch',
      sourceType: 'orchestration',
      repoPath: '/repo',
      worktreePath: worktree,
      status: 'idle',
    } as never);
    await expect(requestReview('orch', async () => ({}) as never)).rejects.toThrow(
      /worktree agent thread/,
    );
  });

  it('creates a Review tab with repo guidelines and sends Review.', async () => {
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '## Recommendation required\n');
    const from = {
      id: 'from-id',
      sourceType: 'branch',
      repoPath: '/repo',
      worktreePath: worktree,
      status: 'idle',
      title: 'Feature',
    };
    const tab = { id: 'review-tab', title: 'Review', status: 'queued' };
    findMock.mockReturnValue(from as never);
    createTabMock.mockReturnValue(tab as never);
    const send = vi.fn(async () => tab as never);

    const result = await requestReview('from-id', send);

    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromThreadId: 'from-id',
        title: 'Review',
        attachments: [
          expect.objectContaining({
            name: 'review.md',
            path: REPO_REVIEW_PATH,
            content: expect.stringContaining('Recommendation'),
          }),
        ],
      }),
    );
    expect(send).toHaveBeenCalledWith('review-tab', REVIEW_REQUEST_PREFILL);
    expect(REVIEW_REQUEST_PREFILL).toBe('Review.');
    expect(result.tab.id).toBe('review-tab');
    expect(result.from.id).toBe('from-id');
  });

  it('builds a file attachment with optional path', () => {
    const att = buildReviewRequestAttachment('hello', { path: REPO_REVIEW_PATH });
    expect(att.kind).toBe('file');
    expect(att.path).toBe(REPO_REVIEW_PATH);
    expect(att.name).toBe('review.md');
    expect(att.content).toBe('hello');
  });
});
