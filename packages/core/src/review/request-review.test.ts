import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REVIEW_REQUEST_PATH,
  REVIEW_REQUEST_PREFILL,
  buildReviewRequestAttachment,
  readExistingReviewRequestFile,
  requestReview,
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

  it('reads existing guidelines from the worktree', () => {
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '# custom\n');
    expect(readExistingReviewRequestFile(worktree)).toContain('# custom');
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

  it('creates a Review tab, attaches guidelines, and sends the prefill', async () => {
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '## Recommendation required\n');
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
            name: 'Review request.md',
            path: REVIEW_REQUEST_PATH,
            content: expect.stringContaining('Recommendation'),
          }),
        ],
      }),
    );
    expect(send).toHaveBeenCalledWith('review-tab', REVIEW_REQUEST_PREFILL);
    expect(result.tab.id).toBe('review-tab');
    expect(result.from.id).toBe('from-id');
  });

  it('builds a file attachment', () => {
    const att = buildReviewRequestAttachment('hello');
    expect(att.kind).toBe('file');
    expect(att.content).toBe('hello');
  });
});
