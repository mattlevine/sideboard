import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONTEXT_REVIEW_PATH,
  REPO_REVIEW_PATH,
  REVIEW_REQUEST_PATH,
  REVIEW_REQUEST_PREFILL,
  REVIEW_REQUEST_TEMPLATE,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
  buildReviewRequestAttachment,
  ensureReviewGuidelinesFile,
  ensureReviewRequestFile,
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

  it('copies .sideboard/review.md into .context/review.md when the skill is absent', () => {
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '## Recommendation\nrepo policy\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('repo');
    expect(resolved.path).toBe(CONTEXT_REVIEW_PATH);
    expect(resolved.content).toContain('repo policy');
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(true);
    expect(existsSync(join(worktree, REVIEW_SKILL_PATH))).toBe(false);
  });

  it('copies .sideboard/review.md from the main repo when the worktree has none', () => {
    const repo = join(tmpdir(), `sideboard-review-repo-${Date.now()}`);
    mkdirSync(join(repo, '.sideboard'), { recursive: true });
    writeFileSync(join(repo, REPO_REVIEW_PATH), '## Recommendation\nfrom main repo\n');
    const resolved = resolveReviewGuidelines(worktree, repo);
    expect(resolved.source).toBe('repo');
    expect(resolved.path).toBe(CONTEXT_REVIEW_PATH);
    expect(resolved.content).toContain('from main repo');
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(true);
    expect(existsSync(join(worktree, REPO_REVIEW_PATH))).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it('keeps an existing .context/review.md without rewriting it', () => {
    mkdirSync(join(worktree, '.context'), { recursive: true });
    writeFileSync(join(worktree, CONTEXT_REVIEW_PATH), '## Recommendation\nlocal copy\n');
    writeFileSync(join(worktree, REPO_REVIEW_PATH), '## Recommendation\nrepo newer\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('local');
    expect(resolved.path).toBe(CONTEXT_REVIEW_PATH);
    expect(resolved.content).toContain('local copy');
  });

  it('copies leftover attachments into .context/review.md', () => {
    mkdirSync(join(worktree, '.context', 'attachments'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_REQUEST_PATH), '## Recommendation\nlocal\n');
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('local');
    expect(resolved.path).toBe(CONTEXT_REVIEW_PATH);
    expect(resolved.content).toContain('local');
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(true);
  });

  it('seeds .context/review.md from stock when no skill or sideboard file exists', () => {
    const resolved = resolveReviewGuidelines(worktree);
    expect(resolved.source).toBe('stock');
    expect(resolved.path).toBe(CONTEXT_REVIEW_PATH);
    expect(existsSync(join(worktree, REVIEW_SKILL_PATH))).toBe(false);
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(true);
    expect(resolved.content).not.toContain('name: review');
    expect(resolved.content).toContain('## Required outcome');
  });

  it('does not create a review skill when one is already present', () => {
    mkdirSync(join(worktree, '.claude', 'skills', 'review'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_SKILL_PATH), wrapReviewSkillMarkdown('# skill policy\n'));
    const seeded = ensureReviewGuidelinesFile(worktree);
    expect(seeded.wrote).toBe(false);
    expect(seeded.path).toBe(REVIEW_SKILL_PATH);
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(false);
  });

  it('customize writes .context/review.md when no review skill exists', () => {
    const ensured = ensureReviewRequestFile(worktree);
    expect(ensured.source).toBe('stock');
    expect(ensured.path).toBe(CONTEXT_REVIEW_PATH);
    expect(existsSync(join(worktree, REVIEW_SKILL_PATH))).toBe(false);
    expect(existsSync(join(worktree, CONTEXT_REVIEW_PATH))).toBe(true);
    expect(readExistingReviewRequestFile(worktree)).toContain('## Required outcome');
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

  it('stock template grows an existing review skill, else .context/review.md', () => {
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/Growing the rules/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/\.claude\/skills\/review\/SKILL\.md/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/\.context\/review\.md/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/do not create a review skill/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/\.sideboard\/skills\//);
  });
});
