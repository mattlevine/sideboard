import {
  REVIEW_REQUEST_TEMPLATE,
  type ThreadAttachment,
} from '@sideboard-ai/core';

export { REVIEW_REQUEST_TEMPLATE };

/** Committed per-repo review guidelines (preferred when present). */
export const REPO_REVIEW_PATH = '.sideboard/review.md';

export const REPO_REVIEW_NAME = 'review.md';

/** Local scratch guidelines (gitignored under `.context/attachments/`). */
export const REVIEW_REQUEST_PATH = '.context/attachments/Review request.md';

export const REVIEW_REQUEST_NAME = 'Review request.md';

export const REVIEW_REQUEST_PREFILL = 'Review changes in this workspace.';

/** Stock template from before readiness recommendations were required. */
const LEGACY_REVIEW_TEMPLATE_MARKERS = [
  'You are acting as a reviewer for a proposed code change made by another engineer.',
  'HOW MANY FINDINGS TO RETURN:',
];

/**
 * Refresh on-disk Review request.md when it still looks like the old findings-only
 * stock template (no readiness recommendation). Preserve real user customizations.
 */
export function shouldRefreshReviewRequestTemplate(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/##\s*Recommendation|ready to merge|Approve with nits|Request changes/i.test(trimmed)) {
    return false;
  }
  return LEGACY_REVIEW_TEMPLATE_MARKERS.every((m) => trimmed.includes(m));
}

export function buildReviewRequestAttachment(
  content: string,
  opts?: { path?: string; name?: string },
): ThreadAttachment {
  const path = opts?.path ?? REVIEW_REQUEST_PATH;
  const name = opts?.name ?? (path === REPO_REVIEW_PATH ? REPO_REVIEW_NAME : REVIEW_REQUEST_NAME);
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'file',
    path,
    content,
  };
}

export type ReviewGuidelinesSource = 'repo' | 'local' | 'stock';

export interface ResolvedReviewGuidelines {
  path: string;
  name: string;
  content: string;
  source: ReviewGuidelinesSource;
}

async function readTextIfPresent(threadId: string, relativePath: string): Promise<string | null> {
  try {
    const existing = await window.sideboard.readFile(threadId, relativePath);
    if (!existing.binary && existing.content.trim()) {
      return existing.content;
    }
  } catch {
    // absent
  }
  return null;
}

/**
 * Read existing guidelines without creating files.
 * Prefers repo `.sideboard/review.md`, then local attachments copy.
 */
export async function readExistingReviewRequestFile(
  threadId: string,
): Promise<string | null> {
  return (
    (await readTextIfPresent(threadId, REPO_REVIEW_PATH)) ??
    (await readTextIfPresent(threadId, REVIEW_REQUEST_PATH))
  );
}

/**
 * Ensure a file the user can edit for guidelines (Customize menu).
 * Prefers committed `.sideboard/review.md`. Keeps an existing local attachments
 * file if that is already customized and the repo file is absent.
 */
export async function ensureReviewRequestFile(
  threadId: string,
): Promise<ResolvedReviewGuidelines> {
  const repoContent = await readTextIfPresent(threadId, REPO_REVIEW_PATH);
  if (repoContent) {
    return {
      path: REPO_REVIEW_PATH,
      name: REPO_REVIEW_NAME,
      content: repoContent,
      source: 'repo',
    };
  }

  const localContent = await readTextIfPresent(threadId, REVIEW_REQUEST_PATH);
  if (localContent && !shouldRefreshReviewRequestTemplate(localContent)) {
    return {
      path: REVIEW_REQUEST_PATH,
      name: REVIEW_REQUEST_NAME,
      content: localContent,
      source: 'local',
    };
  }

  await window.sideboard.writeFile(threadId, REPO_REVIEW_PATH, REVIEW_REQUEST_TEMPLATE);
  return {
    path: REPO_REVIEW_PATH,
    name: REPO_REVIEW_NAME,
    content: REVIEW_REQUEST_TEMPLATE,
    source: 'repo',
  };
}
