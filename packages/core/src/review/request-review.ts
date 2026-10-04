import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Thread, ThreadAttachment } from '../types/thread.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { createChatTab, threadsSharingWorktree } from '../threads/chat-tabs.js';
import { findThreadByRef, updateThread } from '../store/thread-store.js';
import { REVIEW_TAB_TITLE } from './review-write-gate.js';
import {
  REVIEW_REQUEST_TEMPLATE,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
  wrapReviewSkillMarkdown,
} from './review-request-template.js';
export {
  REVIEW_REQUEST_TEMPLATE,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
  wrapReviewSkillMarkdown,
};
import { ATTACHMENTS_DIR, LEGACY_ATTACHMENTS_DIR } from '../paths/workspace-scratch.js';

/** Repo-level source copied into the worktree `.context` when no review skill exists. */
export const REPO_REVIEW_PATH = '.sideboard/review.md';

export const REPO_REVIEW_NAME = 'review.md';

/** Worktree working copy (gitignored). Review attaches this when there is no skill. */
export const CONTEXT_REVIEW_PATH = '.context/review.md';

/**
 * Leftover local scratch from an older fallback. Still read; new writes go to
 * {@link CONTEXT_REVIEW_PATH}.
 */
export const REVIEW_REQUEST_PATH = `${ATTACHMENTS_DIR}/Review request.md`;

export const LEGACY_REVIEW_REQUEST_PATH = `${LEGACY_ATTACHMENTS_DIR}/Review request.md`;

export const REVIEW_REQUEST_NAME = 'Review request.md';

/** Short chat message — guidelines live in the attached review file. */
export const REVIEW_REQUEST_PREFILL = 'Review changes in this workspace.';

/** Stock template from before readiness recommendations were required. */
const LEGACY_REVIEW_TEMPLATE_MARKERS = [
  'You are acting as a reviewer for a proposed code change made by another engineer.',
  'HOW MANY FINDINGS TO RETURN:',
];

export type ReviewGuidelinesSource = 'skill' | 'repo' | 'local' | 'stock';

export interface ResolvedReviewGuidelines {
  path: string;
  name: string;
  content: string;
  source: ReviewGuidelinesSource;
}

/**
 * Refresh on-disk local Review request.md when it still looks like the old
 * findings-only stock template. Preserve real user customizations.
 */
export function shouldRefreshReviewRequestTemplate(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/##\s*Recommendation|ready to merge|Approve with nits|Request changes/i.test(trimmed)) {
    return false;
  }
  return LEGACY_REVIEW_TEMPLATE_MARKERS.every((m) => trimmed.includes(m));
}

function readTextIfPresent(abs: string): string | null {
  if (!existsSync(abs)) return null;
  try {
    const content = readFileSync(abs, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function readLocalGuidelines(worktreePath: string): { path: string; content: string } | null {
  const localAbs = join(worktreePath, REVIEW_REQUEST_PATH);
  const localContent = readTextIfPresent(localAbs);
  if (localContent && !shouldRefreshReviewRequestTemplate(localContent)) {
    return { path: REVIEW_REQUEST_PATH, content: localContent };
  }
  const legacyAbs = join(worktreePath, LEGACY_REVIEW_REQUEST_PATH);
  const legacyContent = readTextIfPresent(legacyAbs);
  if (legacyContent && !shouldRefreshReviewRequestTemplate(legacyContent)) {
    return { path: LEGACY_REVIEW_REQUEST_PATH, content: legacyContent };
  }
  return null;
}

function skillGuidelines(content: string, source: ReviewGuidelinesSource): ResolvedReviewGuidelines {
  return {
    path: REVIEW_SKILL_PATH,
    name: REVIEW_SKILL_NAME,
    content,
    source,
  };
}

function contextGuidelines(
  content: string,
  source: ReviewGuidelinesSource,
): ResolvedReviewGuidelines {
  return {
    path: CONTEXT_REVIEW_PATH,
    name: REPO_REVIEW_NAME,
    content,
    source,
  };
}

function writeContextGuidelines(worktreePath: string, content: string): string {
  const abs = join(worktreePath, CONTEXT_REVIEW_PATH);
  mkdirSync(dirname(abs), { recursive: true });
  const body = content.endsWith('\n') ? content : `${content}\n`;
  writeFileSync(abs, body, 'utf8');
  return body;
}

function readSideboardReview(worktreePath: string, repoPath?: string): string | null {
  const fromWorktree = readTextIfPresent(join(worktreePath, REPO_REVIEW_PATH));
  if (fromWorktree) return fromWorktree;
  const repo = repoPath?.replace(/\/+$/, '');
  const wt = worktreePath.replace(/\/+$/, '');
  if (!repo || repo === wt) return null;
  return readTextIfPresent(join(repo, REPO_REVIEW_PATH));
}

export interface EnsuredReviewGuidelines extends ResolvedReviewGuidelines {
  wrote: boolean;
}

/**
 * Prefer an existing `.claude/skills/review/SKILL.md`. Otherwise copy
 * `.sideboard/review.md` (worktree, then main repo) into
 * `.context/review.md`. Never creates a Claude skill.
 */
export function ensureReviewGuidelinesFile(
  worktreePath: string,
  repoPath?: string,
): EnsuredReviewGuidelines {
  const skillContent = readTextIfPresent(join(worktreePath, REVIEW_SKILL_PATH));
  if (skillContent) {
    return { ...skillGuidelines(skillContent, 'skill'), wrote: false };
  }

  const contextContent = readTextIfPresent(join(worktreePath, CONTEXT_REVIEW_PATH));
  if (contextContent && !shouldRefreshReviewRequestTemplate(contextContent)) {
    return { ...contextGuidelines(contextContent, 'local'), wrote: false };
  }

  const fromSideboard = readSideboardReview(worktreePath, repoPath);
  if (fromSideboard && !shouldRefreshReviewRequestTemplate(fromSideboard)) {
    const body = writeContextGuidelines(worktreePath, fromSideboard);
    return { ...contextGuidelines(body, 'repo'), wrote: true };
  }

  const local = readLocalGuidelines(worktreePath);
  const body = writeContextGuidelines(worktreePath, local?.content ?? REVIEW_REQUEST_TEMPLATE);
  return {
    ...contextGuidelines(body, local ? 'local' : 'stock'),
    wrote: true,
  };
}

/**
 * @deprecated Prefer {@link ensureReviewGuidelinesFile}. Never writes a Claude skill.
 */
export function ensureReviewSkillFile(
  worktreePath: string,
  repoPath?: string,
): {
  path: string;
  content: string;
  wrote: boolean;
} {
  const g = ensureReviewGuidelinesFile(worktreePath, repoPath);
  return { path: g.path, content: g.content, wrote: g.wrote };
}

/**
 * Resolve which review guidelines to attach:
 * 1. `.claude/skills/review/SKILL.md` (committed Claude skill, if present)
 * 2. `.context/review.md` (worktree copy)
 * 3. Copy `.sideboard/review.md` from the worktree or main repo into `.context/review.md`
 * 4. Seed `.context/review.md` from stock
 */
export function resolveReviewGuidelines(
  worktreePath: string,
  repoPath?: string,
): ResolvedReviewGuidelines {
  return ensureReviewGuidelinesFile(worktreePath, repoPath);
}

/**
 * Ensure a file the user can edit for guidelines.
 * Prefers an existing review skill; otherwise writes `.context/review.md`.
 */
export function ensureReviewRequestFile(
  worktreePath: string,
  repoPath?: string,
): ResolvedReviewGuidelines {
  return ensureReviewGuidelinesFile(worktreePath, repoPath);
}

export function buildReviewRequestAttachment(
  content: string,
  opts?: { path?: string; name?: string },
): ThreadAttachment {
  const path = opts?.path ?? REVIEW_SKILL_PATH;
  const name =
    opts?.name ??
    (path === REVIEW_SKILL_PATH
      ? REVIEW_SKILL_NAME
      : path === REPO_REVIEW_PATH || path === CONTEXT_REVIEW_PATH
        ? REPO_REVIEW_NAME
        : REVIEW_REQUEST_NAME);
  return {
    id: randomUUID(),
    name,
    kind: 'file',
    path,
    content,
  };
}

/**
 * Read existing guidelines without creating files.
 * Prefers the review skill, then legacy `.sideboard/review.md`, then local copy.
 */
export function readExistingReviewRequestFile(worktreePath: string): string | null {
  return (
    readTextIfPresent(join(worktreePath, REVIEW_SKILL_PATH)) ??
    readTextIfPresent(join(worktreePath, CONTEXT_REVIEW_PATH)) ??
    readTextIfPresent(join(worktreePath, REPO_REVIEW_PATH)) ??
    readTextIfPresent(join(worktreePath, REVIEW_REQUEST_PATH)) ??
    readTextIfPresent(join(worktreePath, LEGACY_REVIEW_REQUEST_PATH))
  );
}

export interface RequestReviewResult {
  /** Review chat (reused idle singleton or a new tab). */
  tab: Thread;
  /** Worktree thread that was reviewed (source of the tab). Same as `tab` when reused. */
  from: Thread;
}

type SendFn = (threadRef: string, prompt: string) => Promise<Thread>;

type ReviewReuseThread = Pick<Thread, 'id' | 'status' | 'messages' | 'queue'>;

/**
 * True when this worktree has exactly one live agent and it has never been
 * used (idle, no chat, no queued prompt). Review runs there instead of a
 * second tab.
 */
export function canReuseIdleWorktreeAgentForReview(
  from: ReviewReuseThread,
  siblings: ReviewReuseThread[],
): boolean {
  const live = siblings.filter((t) => t.status !== 'archived');
  if (live.length !== 1) return false;
  const only = live[0]!;
  if (only.id !== from.id) return false;
  if (from.status !== 'idle') return false;
  if ((from.queue?.length ?? 0) > 0) return false;
  return (from.messages?.length ?? 0) === 0 && (only.messages?.length ?? 0) === 0;
}

function reviewGuidelinesAttachment(from: Thread): ThreadAttachment {
  const guidelines = resolveReviewGuidelines(from.worktreePath, from.repoPath);
  return buildReviewRequestAttachment(guidelines.content, {
    path: guidelines.path,
    name: guidelines.name,
  });
}

/**
 * Run a merge-readiness review on a worktree. Reuses the only unused agent
 * when the checkout has a single idle chat with no messages; otherwise opens
 * a new Review tab so existing work is not interrupted.
 */
export async function requestReview(
  threadRef: string,
  send: SendFn,
): Promise<RequestReviewResult> {
  const from = findThreadByRef(threadRef);
  if (!from) throw new Error(`Thread not found: ${threadRef}`);
  if (isOrchestratorThread(from)) {
    throw new Error(
      'request_review targets a worktree agent thread (not the orchestrator). Pass a child/worktree thread ref.',
    );
  }
  if (from.status === 'archived') {
    throw new Error(`Thread is archived: ${from.id}`);
  }

  const attachment = reviewGuidelinesAttachment(from);
  const siblings = threadsSharingWorktree(from.worktreePath);
  if (canReuseIdleWorktreeAgentForReview(from, siblings)) {
    const reused = updateThread(from.id, {
      title: REVIEW_TAB_TITLE,
      userSetTitle: true,
      attachments: [...(from.attachments ?? []), attachment],
    });
    const started = await send(reused.id, REVIEW_REQUEST_PREFILL);
    return { tab: started, from: reused };
  }

  const tab = createChatTab({
    fromThreadId: from.id,
    title: REVIEW_TAB_TITLE,
    attachments: [attachment],
  });
  const started = await send(tab.id, REVIEW_REQUEST_PREFILL);
  return { tab: started, from };
}
