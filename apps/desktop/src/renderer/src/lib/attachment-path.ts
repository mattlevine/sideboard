import type { ThreadAttachment } from '@sideboard-ai/core';
import {
  REPO_REVIEW_NAME,
  REPO_REVIEW_PATH,
  REVIEW_REQUEST_NAME,
  REVIEW_REQUEST_PATH,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_PATH,
} from './review-request';

/** Worktree path to open when clicking a composer attachment chip, if any. */
export function attachmentOpenPath(att: ThreadAttachment): string | null {
  const raw = att.path?.trim();
  // Folder refs use a trailing slash and are not opened as files.
  if (raw) return raw.endsWith('/') ? null : raw;
  if (att.kind === 'file') {
    if (att.name === REVIEW_SKILL_NAME) return REVIEW_SKILL_PATH;
    if (att.name === REPO_REVIEW_NAME) return REPO_REVIEW_PATH;
    if (att.name === REVIEW_REQUEST_NAME) return REVIEW_REQUEST_PATH;
    if (att.name.includes('/')) return att.name;
  }
  if (att.kind === 'diff-comment' || att.kind === 'code-ref') {
    const m = /^(.+):L\d+(?:-\d+)?$/.exec(att.name);
    if (m?.[1]) return m[1];
  }
  return null;
}
