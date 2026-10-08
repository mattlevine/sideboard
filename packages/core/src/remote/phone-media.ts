import { readWorktreeFileForUpload } from '../diff/diff.js';

/** Keep a phone frame small enough to cross the relay. */
const PHONE_IMAGE_MAX_BYTES = 1_500_000;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export type PhoneOpenFileRequest = {
  threadId: string;
  path: string;
  directory?: boolean;
  startLine?: number;
  endLine?: number;
};

/** Map a markdown path onto a worktree-relative file. Rejects anything outside that folder. */
export function phoneWorktreeRelative(worktreePath: string, raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      return null;
    }
  }
  text = (text.split('#')[0] ?? text).replace(/\\/g, '/');
  if (!text || text.includes('\0') || text.split('/').includes('..')) return null;
  const root = worktreePath.replace(/\/+$/, '');
  if (!root || root === '/') return null;
  if (text.startsWith('/')) {
    if (text !== root && !text.startsWith(`${root}/`)) return null;
    text = text === root ? '' : text.slice(root.length + 1);
  }
  text = text.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!text || text === '.' || text.startsWith('/')) return null;
  return text;
}

export function phoneImageMime(relativePath: string): string | null {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME[ext] ?? null;
}

/** Inline a worktree image for the phone, or null when it is missing, not an image, or too large. */
export function phoneImageDataUrl(worktreePath: string, raw: string): string | null {
  const relative = phoneWorktreeRelative(worktreePath, raw);
  if (!relative) return null;
  const mime = phoneImageMime(relative);
  if (!mime) return null;
  try {
    const file = readWorktreeFileForUpload(worktreePath, relative, { maxBytes: PHONE_IMAGE_MAX_BYTES });
    return `data:${mime};base64,${file.contentBase64}`;
  } catch {
    return null;
  }
}
