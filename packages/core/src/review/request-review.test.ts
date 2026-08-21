import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REPO_REVIEW_PATH,
  REVIEW_REQUEST_PATH,
  REVIEW_REQUEST_PREFILL,
  REVIEW_REQUEST_TEMPLATE,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
  buildReviewRequestAttachment,
  ensureReviewRequestFile,
  ensureReviewSkillFile,
  readExistingReviewRequestFile,
  requestReview,
  resolveReviewGuidelines,
  wrapReviewSkillMarkdown,
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

  it('prefers .claude/skills/review/SKILL.md over legacy review.md and local attachments', () => {
    mkdirSync(join(worktree, '.context', 'attachments'), { recursive: true });
    mkdirSync(join(worktree, '.claude', 'skills', 'review'), { recursive: true });
    mkdirSync(join(worktree, '.sideboard'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '# local only\n');
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '# repo policy\n');
    writeFileSync(join(worktree, REVIEW_SKILL_PATH), wrapReviewSkillMarkdown('# skill policy\n'));
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('skill');
    expect(resolved.path).toBe(REVIEW_SKILL_PATH);
    expect(resolved.name).toBe(REVIEW_SKILL_NAME);
    expect(resolved.content).toContain('skill policy');
  });

  it('uses local attachments when the skill and repo file are absent', () => {
    mkdirSync(join(worktree, '.context', 'attachments'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '## Recommendation\nlocal\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('local');
    expect(resolved.path).toBe(REVIEW_REQUEST_PATH);
    expect(resolved.content).toContain('local');
  });

  it('seeds .claude/skills/review/SKILL.md from stock when nothing exists', () => {
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('stock');
    expect(resolved.path).toBe(REVIEW_SKILL_PATH);
    expect(existsSync(join(worktree, REVIEW_SKILL_PATH))).toBe(true);
    expect(existsSync(join(worktree, REVIEW_REQUEST_PATH))).toBe(false);
    expect(resolved.content).toContain('name: review');
    expect(resolved.content).toContain('## Required outcome');
  });

  it('copies legacy .sideboard/review.md into the skill on setup', () => {
    mkdirSync(join(worktree, '.sideboard'), { recursive: true });
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '# custom repo\n');
    const seeded = ensureReviewSkillFile(worktree);
    expect(seeded.wrote).toBe(true);
    expect(seeded.content).toContain('custom repo');
    expect(seeded.content).toContain('name: review');
    expect(readExistingReviewRequestFile(worktree)).toContain('custom repo');
  });

  it('customize ensures the review skill when neither exists', () => {
    const ensured = ensureReviewRequestFile(worktree);
    expect(ensured.source).toBe('skill');
    expect(ensured.path).toBe(REVIEW_SKILL_PATH);
    expect(existsSync(join(worktree, REVIEW_SKILL_PATH))).toBe(true);
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

  it('creates a Review tab with the review skill and sends the review prefill', async () => {
    mkdirSync(join(worktree, '.claude', 'skills', 'review'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_SKILL_PATH), wrapReviewSkillMarkdown('## Recommendation required\n'));
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
            name: REVIEW_SKILL_NAME,
            path: REVIEW_SKILL_PATH,
            content: expect.stringContaining('Recommendation'),
          }),
        ],
      }),
    );
    expect(send).toHaveBeenCalledWith('review-tab', REVIEW_REQUEST_PREFILL);
    expect(REVIEW_REQUEST_PREFILL).toBe('Review changes in this workspace.');
    expect(result.tab.id).toBe('review-tab');
    expect(result.from.id).toBe('from-id');
  });

  it('builds a file attachment with optional path', () => {
    const att = buildReviewRequestAttachment('hello', { path: REVIEW_SKILL_PATH });
    expect(att.kind).toBe('file');
    expect(att.path).toBe(REVIEW_SKILL_PATH);
    expect(att.name).toBe(REVIEW_SKILL_NAME);
    expect(att.content).toBe('hello');
  });

  it('stock template asks reviewers to grow the review skill', () => {
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/Growing the rules/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/\.claude\/skills\/review\/SKILL\.md/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/that is allowed/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/\.sideboard\/skills\//);
  });
});
