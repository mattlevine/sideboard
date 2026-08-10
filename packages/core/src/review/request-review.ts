import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Thread, ThreadAttachment } from '../types/thread.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { createChatTab } from '../threads/chat-tabs.js';
import { findThreadByRef } from '../store/thread-store.js';
import { REVIEW_REQUEST_TEMPLATE } from './review-request-template.js';

/** Committed per-repo review guidelines (preferred when present). */
export const REPO_REVIEW_PATH = '.sideboard/review.md';

export const REPO_REVIEW_NAME = 'review.md';

/**
 * Local / Conductor-style scratch guidelines (gitignored under attachments/).
 * Used as override when no repo file exists, or as the stock seed target.
 */
export const REVIEW_REQUEST_PATH = '.sideboard/attachments/Review request.md';

export const REVIEW_REQUEST_NAME = 'Review request.md';

/** Short chat message — guidelines live in the attached review file. */
export const REVIEW_REQUEST_PREFILL = 'Review.';

const ATTACHMENTS_GITIGNORE = `# Sideboard review / composer attachments (local only)
*
!.gitignore
`;

/** Stock template from before readiness recommendations were required. */
const LEGACY_REVIEW_TEMPLATE_MARKERS = [
  'You are acting as a reviewer for a proposed code change made by another engineer.',
  'HOW MANY FINDINGS TO RETURN:',
];

export type ReviewGuidelinesSource = 'repo' | 'local' | 'stock';

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

function ensureAttachmentsGitignore(worktreePath: string): void {
  const gitignoreAbs = join(worktreePath, '.sideboard', 'attachments', '.gitignore');
  if (existsSync(gitignoreAbs)) return;
  mkdirSync(dirname(gitignoreAbs), { recursive: true });
  writeFileSync(gitignoreAbs, ATTACHMENTS_GITIGNORE, 'utf8');
}

/**
 * Resolve which review guidelines to attach:
 * 1. `.sideboard/review.md` (committed, per-repo)
 * 2. `.sideboard/attachments/Review request.md` (local override)
 * 3. Seed stock template into the local attachments path (does not write the repo file)
 */
export function resolveReviewGuidelines(worktreePath: string): ResolvedReviewGuidelines {
  const repoAbs = join(worktreePath, REPO_REVIEW_PATH);
  const repoContent = readTextIfPresent(repoAbs);
  if (repoContent) {
    return {
      path: REPO_REVIEW_PATH,
      name: REPO_REVIEW_NAME,
      content: repoContent,
      source: 'repo',
    };
  }

  const localAbs = join(worktreePath, REVIEW_REQUEST_PATH);
  const localContent = readTextIfPresent(localAbs);
  if (localContent && !shouldRefreshReviewRequestTemplate(localContent)) {
    return {
      path: REVIEW_REQUEST_PATH,
      name: REVIEW_REQUEST_NAME,
      content: localContent,
      source: 'local',
    };
  }

  ensureAttachmentsGitignore(worktreePath);
  mkdirSync(dirname(localAbs), { recursive: true });
  writeFileSync(localAbs, REVIEW_REQUEST_TEMPLATE, 'utf8');
  return {
    path: REVIEW_REQUEST_PATH,
    name: REVIEW_REQUEST_NAME,
    content: REVIEW_REQUEST_TEMPLATE,
    source: 'stock',
  };
}

/**
 * Ensure a file the user can edit for guidelines.
 * Prefers creating/opening committed `.sideboard/review.md` (per-repo).
 * Falls back to refreshing a legacy local attachments file only when that is
 * what already exists and the repo file does not.
 */
export function ensureReviewRequestFile(worktreePath: string): ResolvedReviewGuidelines {
  const repoAbs = join(worktreePath, REPO_REVIEW_PATH);
  const repoContent = readTextIfPresent(repoAbs);
  if (repoContent) {
    return {
      path: REPO_REVIEW_PATH,
      name: REPO_REVIEW_NAME,
      content: repoContent,
      source: 'repo',
    };
  }

  const localAbs = join(worktreePath, REVIEW_REQUEST_PATH);
  const localContent = readTextIfPresent(localAbs);
  if (localContent && !shouldRefreshReviewRequestTemplate(localContent)) {
    // Legacy local-only customize — don't force a repo file over an existing local one.
    return {
      path: REVIEW_REQUEST_PATH,
      name: REVIEW_REQUEST_NAME,
      content: localContent,
      source: 'local',
    };
  }

  mkdirSync(dirname(repoAbs), { recursive: true });
  writeFileSync(repoAbs, REVIEW_REQUEST_TEMPLATE, 'utf8');
  return {
    path: REPO_REVIEW_PATH,
    name: REPO_REVIEW_NAME,
    content: REVIEW_REQUEST_TEMPLATE,
    source: 'repo',
  };
}

export function buildReviewRequestAttachment(
  content: string,
  opts?: { path?: string; name?: string },
): ThreadAttachment {
  const path = opts?.path ?? REVIEW_REQUEST_PATH;
  const name = opts?.name ?? (path === REPO_REVIEW_PATH ? REPO_REVIEW_NAME : REVIEW_REQUEST_NAME);
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
 * Prefers repo `.sideboard/review.md`, then local attachments copy.
 */
export function readExistingReviewRequestFile(worktreePath: string): string | null {
  return (
    readTextIfPresent(join(worktreePath, REPO_REVIEW_PATH)) ??
    readTextIfPresent(join(worktreePath, REVIEW_REQUEST_PATH))
  );
}

export interface RequestReviewResult {
  /** New Review chat tab. */
  tab: Thread;
  /** Worktree thread that was reviewed (source of the tab). */
  from: Thread;
}

type SendFn = (threadRef: string, prompt: string) => Promise<Thread>;

/**
 * Open a fresh "Review" chat tab, attach resolved guidelines, send "Review."
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

  const guidelines = resolveReviewGuidelines(from.worktreePath);
  const tab = createChatTab({
    fromThreadId: from.id,
    title: 'Review',
    attachments: [
      buildReviewRequestAttachment(guidelines.content, {
        path: guidelines.path,
        name: guidelines.name,
      }),
    ],
  });
  const started = await send(tab.id, REVIEW_REQUEST_PREFILL);
  return { tab: started, from };
}
