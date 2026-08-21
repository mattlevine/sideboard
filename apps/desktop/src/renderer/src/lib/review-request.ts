import type { ThreadAttachment } from '@sideboard-ai/core';
import {
  REVIEW_REQUEST_TEMPLATE,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
  wrapReviewSkillMarkdown,
} from '@sideboard/review-request-template';

export { REVIEW_REQUEST_TEMPLATE, REVIEW_SKILL_NAME, REVIEW_SKILL_PATH };

/** Legacy committed guidelines. New repos use {@link REVIEW_SKILL_PATH}. */
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
  const path = opts?.path ?? REVIEW_SKILL_PATH;
  const name =
    opts?.name ??
    (path === REVIEW_SKILL_PATH
      ? REVIEW_SKILL_NAME
      : path === REPO_REVIEW_PATH
        ? REPO_REVIEW_NAME
        : REVIEW_REQUEST_NAME);
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'file',
    path,
    content,
  };
}

export type ReviewGuidelinesSource = 'skill' | 'repo' | 'local' | 'stock';

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
 * Prefers the review skill, then legacy `.sideboard/review.md`, then local copy.
 */
export async function readExistingReviewRequestFile(
  threadId: string,
): Promise<string | null> {
  return (
    (await readTextIfPresent(threadId, REVIEW_SKILL_PATH)) ??
    (await readTextIfPresent(threadId, REPO_REVIEW_PATH)) ??
    (await readTextIfPresent(threadId, REVIEW_REQUEST_PATH))
  );
}

/**
 * Ensure a file the user can edit for guidelines (Customize menu).
 * Writes `.claude/skills/review/SKILL.md` when missing (copies legacy
 * `.sideboard/review.md` or a customized local attachment).
 */
export async function ensureReviewRequestFile(
  threadId: string,
): Promise<ResolvedReviewGuidelines> {
  const skillContent = await readTextIfPresent(threadId, REVIEW_SKILL_PATH);
  if (skillContent) {
    return {
      path: REVIEW_SKILL_PATH,
      name: REVIEW_SKILL_NAME,
      content: skillContent,
      source: 'skill',
    };
  }

  const repoContent = await readTextIfPresent(threadId, REPO_REVIEW_PATH);
  const localContent = await readTextIfPresent(threadId, REVIEW_REQUEST_PATH);
  const body =
    repoContent ??
    (localContent && !shouldRefreshReviewRequestTemplate(localContent)
      ? localContent
      : REVIEW_REQUEST_TEMPLATE);
  const content = wrapReviewSkillMarkdown(body);
  await window.sideboard.writeFile(threadId, REVIEW_SKILL_PATH, content);
  return {
    path: REVIEW_SKILL_PATH,
    name: REVIEW_SKILL_NAME,
    content,
    source: 'skill',
  };
}
