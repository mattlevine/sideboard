import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWorktreeFile, readWorktreeFileForUpload } from '../diff/diff.js';

/** Keep a phone frame small enough to cross the relay. */
const PHONE_IMAGE_MAX_BYTES = 1_500_000;
const PHONE_TEXT_MAX_BYTES = 180_000;
const PHONE_DIR_MAX = 200;

export type PhoneFilePreview = {
  content: string;
  encoding: 'utf8' | 'base64';
  binary: boolean;
  directory: boolean;
  truncated: boolean;
  mime?: string;
};

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

/** Names in a worktree folder. Directories end with `/`. */
export function phoneDirectoryListing(
  worktreePath: string,
  relative: string,
): { content: string; truncated: boolean } | null {
  try {
    const entries = readdirSync(join(worktreePath, relative), { withFileTypes: true });
    const dirs = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => name && !name.includes('/') && !name.includes('\0'))
      .sort((a, b) => a.localeCompare(b));
    const shown = names.slice(0, PHONE_DIR_MAX);
    const lines = shown.map((name) => (dirs.has(name) ? `${name}/` : name));
    const truncated = names.length > shown.length;
    if (truncated) lines.push(`… ${names.length - shown.length} more`);
    return { content: lines.join('\n'), truncated };
  } catch {
    return null;
  }
}

/** File text, an image data URL, or a directory listing for the phone viewer. */
export function phoneFilePreview(
  worktreePath: string,
  relative: string,
  kind: 'file' | 'dir',
): PhoneFilePreview | null {
  if (kind === 'dir') {
    const listing = phoneDirectoryListing(worktreePath, relative);
    if (!listing) return null;
    return {
      content: listing.content,
      encoding: 'utf8',
      binary: false,
      directory: true,
      truncated: listing.truncated,
    };
  }
  if (relative.toLowerCase().endsWith('.svg')) {
    try {
      const buf = readFileSync(join(worktreePath, relative));
      const truncated = buf.length > PHONE_TEXT_MAX_BYTES;
      return {
        content: buf.subarray(0, PHONE_TEXT_MAX_BYTES).toString('utf8'),
        encoding: 'utf8',
        binary: false,
        directory: false,
        truncated,
        mime: 'image/svg+xml',
      };
    } catch {
      return null;
    }
  }
  const mime = phoneImageMime(relative);
  if (mime) {
    const dataUrl = phoneImageDataUrl(worktreePath, relative);
    if (!dataUrl) return null;
    return {
      content: dataUrl,
      encoding: 'base64',
      binary: true,
      directory: false,
      truncated: false,
      mime,
    };
  }
  try {
    const file = readWorktreeFile(worktreePath, relative, { maxBytes: PHONE_TEXT_MAX_BYTES });
    return {
      content: file.content,
      encoding: file.encoding,
      binary: file.binary,
      directory: false,
      truncated: file.truncated,
    };
  } catch {
    return null;
  }
}
