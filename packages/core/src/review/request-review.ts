import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Thread, ThreadAttachment } from '../types/thread.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { createChatTab } from '../threads/chat-tabs.js';
import { findThreadByRef } from '../store/thread-store.js';
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

/** Legacy committed guidelines. New repos use {@link REVIEW_SKILL_PATH}. */
export const REPO_REVIEW_PATH = '.sideboard/review.md';

export const REPO_REVIEW_NAME = 'review.md';

/**
 * Local scratch guidelines (gitignored under `.context/attachments/`).
 * Used as a gitignored override when the review skill is absent.
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

/**
 * Write `.claude/skills/review/SKILL.md` when missing so Review, Claude Code,
 * and `attach` share one committed file. Copies `.sideboard/review.md` or a
 * customized local attachment when present. Does not git commit.
 */
export function ensureReviewSkillFile(worktreePath: string): {
  path: string;
  content: string;
  wrote: boolean;
} {
  const abs = join(worktreePath, REVIEW_SKILL_PATH);
  const existing = readTextIfPresent(abs);
  if (existing) {
    return { path: REVIEW_SKILL_PATH, content: existing, wrote: false };
  }
  const fromRepo = readTextIfPresent(join(worktreePath, REPO_REVIEW_PATH));
  const fromLocal = readLocalGuidelines(worktreePath)?.content ?? null;
  const content = wrapReviewSkillMarkdown(fromRepo ?? fromLocal ?? REVIEW_REQUEST_TEMPLATE);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return { path: REVIEW_SKILL_PATH, content, wrote: true };
}

/**
 * Resolve which review guidelines to attach:
 * 1. `.claude/skills/review/SKILL.md` (committed Claude skill)
 * 2. `.context/attachments/Review request.md` (local override, gitignored)
 * 3. Legacy `.sideboard/review.md` / `.sideboard/attachments/`
 * 4. Seed the review skill from stock (or copy legacy repo file)
 */
export function resolveReviewGuidelines(worktreePath: string): ResolvedReviewGuidelines {
  const skillContent = readTextIfPresent(join(worktreePath, REVIEW_SKILL_PATH));
  if (skillContent) return skillGuidelines(skillContent, 'skill');

  const local = readLocalGuidelines(worktreePath);
  if (local) {
    return {
      path: local.path,
      name: REVIEW_REQUEST_NAME,
      content: local.content,
      source: 'local',
    };
  }

  const seeded = ensureReviewSkillFile(worktreePath);
  return skillGuidelines(seeded.content, seeded.wrote ? 'stock' : 'skill');
}

/**
 * Ensure a file the user can edit for guidelines.
 * Prefers `.claude/skills/review/SKILL.md` (portable, committed).
 */
export function ensureReviewRequestFile(worktreePath: string): ResolvedReviewGuidelines {
  const seeded = ensureReviewSkillFile(worktreePath);
  return skillGuidelines(seeded.content, 'skill');
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
    readTextIfPresent(join(worktreePath, REPO_REVIEW_PATH)) ??
    readTextIfPresent(join(worktreePath, REVIEW_REQUEST_PATH)) ??
    readTextIfPresent(join(worktreePath, LEGACY_REVIEW_REQUEST_PATH))
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
 * Open a fresh "Review" chat tab, attach resolved guidelines, send the review prefill.
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
