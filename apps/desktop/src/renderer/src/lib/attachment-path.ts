import type { ThreadAttachment } from '@sideboard-ai/core';
import { REVIEW_REQUEST_NAME, REVIEW_REQUEST_PATH } from './review-request';

/** Worktree path to open when clicking a composer attachment chip, if any. */
export function attachmentOpenPath(att: ThreadAttachment): string | null {
  if (att.path?.trim()) return att.path.trim();
  if (att.kind === 'file') {
    if (att.name === REVIEW_REQUEST_NAME) return REVIEW_REQUEST_PATH;
    if (att.name.includes('/')) return att.name;
  }
  if (att.kind === 'diff-comment') {
    const m = /^(.+):L\d+(?:-\d+)?$/.exec(att.name);
    if (m?.[1]) return m[1];
  }
  return null;
}
