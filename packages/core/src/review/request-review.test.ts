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
  canReuseIdleWorktreeAgentForReview,
  ensureReviewGuidelinesFile,
  ensureReviewRequestFile,
  readExistingReviewRequestFile,
  requestReview,
  resolveReviewGuidelines,
  wrapReviewSkillMarkdown,
} from './request-review.js';

vi.mock('../store/thread-store.js', () => ({
  findThreadByRef: vi.fn(),
  updateThread: vi.fn(),
}));

vi.mock('../threads/chat-tabs.js', () => ({
  createChatTab: vi.fn(),
  threadsSharingWorktree: vi.fn(),
}));

import { findThreadByRef, updateThread } from '../store/thread-store.js';
import { createChatTab, threadsSharingWorktree } from '../threads/chat-tabs.js';
import { REVIEW_TAB_TITLE } from './review-write-gate.js';

const findMock = vi.mocked(findThreadByRef);
const updateMock = vi.mocked(updateThread);
const createTabMock = vi.mocked(createChatTab);
const sharingMock = vi.mocked(threadsSharingWorktree);

describe('requestReview', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = join(tmpdir(), `sideboard-review-${Date.now()}`);
    mkdirSync(join(worktree, '.sideboard', 'attachments'), { recursive: true });
    findMock.mockReset();
    updateMock.mockReset();
    updateMock.mockImplementation(((id: string, patch: object) => ({
      id,
      ...patch,
    })) as typeof updateThread);
    createTabMock.mockReset();
    sharingMock.mockReset();
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
    expect(resolved.content).toContain('## Confirm before posting');
    expect(resolved.content).toContain('Do not call ask_user');
    expect(resolved.content).toContain('type the next steps');
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

  it('reuses a single idle unused agent instead of opening a second tab', () => {
    const idle = {
      id: 'solo',
      status: 'idle' as const,
      messages: [],
      queue: [],
    };
    expect(canReuseIdleWorktreeAgentForReview(idle, [idle])).toBe(true);
    expect(
      canReuseIdleWorktreeAgentForReview(idle, [
        idle,
        { id: 'other', status: 'idle', messages: [], queue: [] },
      ]),
    ).toBe(false);
    expect(
      canReuseIdleWorktreeAgentForReview(
        { ...idle, messages: [{ role: 'user', text: 'hi' }] as never },
        [{ ...idle, messages: [{ role: 'user', text: 'hi' }] as never }],
      ),
    ).toBe(false);
    expect(
      canReuseIdleWorktreeAgentForReview(
        { ...idle, messages: [{ role: 'assistant', text: 'ok' }] as never },
        [{ ...idle, messages: [{ role: 'assistant', text: 'ok' }] as never }],
      ),
    ).toBe(false);
    expect(
      canReuseIdleWorktreeAgentForReview({ ...idle, status: 'queued' }, [
        { ...idle, status: 'queued' },
      ]),
    ).toBe(false);
    expect(
      canReuseIdleWorktreeAgentForReview({ ...idle, queue: ['later'] }, [
        { ...idle, queue: ['later'] },
      ]),
    ).toBe(false);
    expect(
      canReuseIdleWorktreeAgentForReview(idle, [
        idle,
        { id: 'old', status: 'archived', messages: [], queue: [] },
      ]),
    ).toBe(true);
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
      messages: [{ role: 'user', text: 'implement it' }],
      attachments: [],
      queue: [],
    };
    const tab = { id: 'review-tab', title: REVIEW_TAB_TITLE, status: 'queued' };
    findMock.mockReturnValue(from as never);
    sharingMock.mockReturnValue([from] as never);
    createTabMock.mockReturnValue(tab as never);
    const send = vi.fn(async () => tab as never);

    const result = await requestReview('from-id', send);

    expect(updateMock).not.toHaveBeenCalled();
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromThreadId: 'from-id',
        title: REVIEW_TAB_TITLE,
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

  it('runs the review in the only unused agent instead of creating a second tab', async () => {
    mkdirSync(join(worktree, '.claude', 'skills', 'review'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_SKILL_PATH), wrapReviewSkillMarkdown('## Recommendation required\n'));
    const from = {
      id: 'solo-id',
      sourceType: 'pr',
      repoPath: '/repo',
      worktreePath: worktree,
      status: 'idle',
      title: 'Ajax',
      messages: [],
      attachments: [],
      queue: [],
    };
    const reused = {
      ...from,
      title: REVIEW_TAB_TITLE,
      userSetTitle: true,
      attachments: [{ name: REVIEW_SKILL_NAME }],
    };
    findMock.mockReturnValue(from as never);
    sharingMock.mockReturnValue([from] as never);
    updateMock.mockReturnValue(reused as never);
    const send = vi.fn(async () => ({ ...reused, status: 'queued' }) as never);

    const result = await requestReview('solo-id', send);

    expect(createTabMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      'solo-id',
      expect.objectContaining({
        title: REVIEW_TAB_TITLE,
        userSetTitle: true,
        attachments: [
          expect.objectContaining({
            name: REVIEW_SKILL_NAME,
            path: REVIEW_SKILL_PATH,
          }),
        ],
      }),
    );
    expect(send).toHaveBeenCalledWith('solo-id', REVIEW_REQUEST_PREFILL);
    expect(result.tab.id).toBe('solo-id');
    expect(result.from.id).toBe('solo-id');
  });

  it('still opens a Review tab when the worktree already has two agents', async () => {
    mkdirSync(join(worktree, '.claude', 'skills', 'review'), { recursive: true });
    writeFileSync(join(worktree, REVIEW_SKILL_PATH), wrapReviewSkillMarkdown('## Recommendation required\n'));
    const from = {
      id: 'first',
      sourceType: 'pr',
      repoPath: '/repo',
      worktreePath: worktree,
      status: 'idle',
      title: 'Ajax',
      messages: [],
      attachments: [],
      queue: [],
    };
    const sibling = { ...from, id: 'second', title: 'Arsenal' };
    const tab = { id: 'review-tab', title: REVIEW_TAB_TITLE, status: 'queued' };
    findMock.mockReturnValue(from as never);
    sharingMock.mockReturnValue([from, sibling] as never);
    createTabMock.mockReturnValue(tab as never);
    const send = vi.fn(async () => tab as never);

    await requestReview('first', send);

    expect(createTabMock).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('review-tab', REVIEW_REQUEST_PREFILL);
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
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/Confirm before posting/);
    expect(REVIEW_REQUEST_TEMPLATE).toMatch(/Do not call ask_user/);
    expect(REVIEW_REQUEST_TEMPLATE).not.toMatch(/ask_user \(Post this review/);
  });
});
