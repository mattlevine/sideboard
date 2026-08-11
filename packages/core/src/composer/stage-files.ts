import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ThreadAttachment } from '../types/thread.js';
import {
  ATTACHMENTS_DIR,
  attachmentsGitignoreBody,
} from '../paths/workspace-scratch.js';

/** Keep in sync with renderer `lib/language.ts` / `diff.ts` IMAGE_EXTENSIONS. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** Inline text/binary content cap (images use path + preview instead). */
const MAX_INLINE_BYTES = 400_000;
/** Cap for data-URL thumbnails stored on pending attachments. */
const MAX_PREVIEW_BYTES = 5_000_000;

function fileExtension(filePath: string): string {
  const base = basename(filePath).toLowerCase();
  return base.includes('.') ? base.split('.').pop() || '' : '';
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(filePath));
}

function imageMimeType(filePath: string): string {
  return IMAGE_MIME_BY_EXT[fileExtension(filePath)] || 'image/png';
}

function ensureAttachmentsDir(worktreePath: string): string {
  const dir = join(worktreePath, ATTACHMENTS_DIR);
  mkdirSync(dir, { recursive: true });
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, attachmentsGitignoreBody(), 'utf8');
  }
  return dir;
}

function uniqueAttachmentName(dir: string, originalName: string): string {
  const safe = originalName.replace(/[/\\]/g, '_') || 'file';
  if (!existsSync(join(dir, safe))) return safe;
  const ext = extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}-${randomUUID()}${ext}`;
}

function previewDataUrlFromBuf(filePath: string, buf: Buffer): string | undefined {
  if (!isImageFilePath(filePath)) return undefined;
  if (buf.length > MAX_PREVIEW_BYTES) return undefined;
  return `data:${imageMimeType(filePath)};base64,${buf.toString('base64')}`;
}

function attachmentFromBuffer(
  name: string,
  buf: Buffer,
  opts: { path?: string; sourceLabel?: string },
): ThreadAttachment {
  const previewDataUrl = previewDataUrlFromBuf(name, buf);
  if (isImageFilePath(name)) {
    const pathHint = opts.path ? `\`${opts.path}\`` : opts.sourceLabel || name;
    return {
      id: randomUUID(),
      name,
      kind: 'file',
      path: opts.path,
      previewDataUrl,
      content: [
        `Image attached: ${pathHint}`,
        opts.path
          ? `Use the Read tool on \`${opts.path}\` to view this image.`
          : 'The image is shown in the composer; copy it into the worktree if you need to inspect pixels.',
      ].join('\n'),
    };
  }

  if (buf.length > MAX_INLINE_BYTES) {
    return {
      id: randomUUID(),
      name,
      kind: 'file',
      path: opts.path,
      content: opts.path
        ? `(file too large to attach inline: \`${opts.path}\`, ${buf.length} bytes — use the Read tool)`
        : `(file too large to attach inline: ${opts.sourceLabel || name}, ${buf.length} bytes)`,
    };
  }

  if (buf.includes(0)) {
    return {
      id: randomUUID(),
      name,
      kind: 'file',
      path: opts.path,
      content: opts.path
        ? `(binary file at \`${opts.path}\` — use tools to inspect)`
        : `(binary file attached by path only: ${opts.sourceLabel || name})`,
    };
  }

  return {
    id: randomUUID(),
    name,
    kind: 'file',
    path: opts.path,
    content: buf.toString('utf8'),
  };
}

/**
 * Build a composer attachment from an absolute filesystem path (no copy).
 * Used by the native file picker when no worktree is available yet.
 */
export function attachmentFromAbsolutePath(absolutePath: string): ThreadAttachment {
  const name = basename(absolutePath);
  try {
    const st = statSync(absolutePath);
    if (!st.isFile()) {
      return {
        id: randomUUID(),
        name,
        kind: 'file',
        content: `(not a file: ${absolutePath})`,
      };
    }
    const buf = readFileSync(absolutePath);
    return attachmentFromBuffer(name, buf, { sourceLabel: absolutePath });
  } catch (err) {
    return {
      id: randomUUID(),
      name,
      kind: 'file',
      content: `(could not read ${absolutePath}: ${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

/**
 * Copy absolute paths into `.context/attachments/` and return composer attachments
 * with worktree-relative `path` (and image previews when applicable).
 */
export function stageAbsolutePathsAsAttachments(
  worktreePath: string,
  absolutePaths: string[],
): ThreadAttachment[] {
  if (absolutePaths.length === 0) return [];
  const dir = ensureAttachmentsDir(worktreePath);
  const out: ThreadAttachment[] = [];
  for (const abs of absolutePaths) {
    const originalName = basename(abs);
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      const name = uniqueAttachmentName(dir, originalName);
      const destAbs = join(dir, name);
      copyFileSync(abs, destAbs);
      const rel = `${ATTACHMENTS_DIR}/${name}`;
      const buf = readFileSync(destAbs);
      out.push(attachmentFromBuffer(name, buf, { path: rel, sourceLabel: abs }));
    } catch (err) {
      out.push({
        id: randomUUID(),
        name: originalName,
        kind: 'file',
        content: `(could not attach ${abs}: ${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }
  return out;
}

export interface ComposerFileBuffer {
  name: string;
  dataBase64: string;
}

/**
 * Write in-memory file buffers into `.context/attachments/` (renderer drop
 * fallback when Electron does not expose a filesystem path).
 */
export function stageBuffersAsAttachments(
  worktreePath: string,
  buffers: ComposerFileBuffer[],
): ThreadAttachment[] {
  if (buffers.length === 0) return [];
  const dir = ensureAttachmentsDir(worktreePath);
  const out: ThreadAttachment[] = [];
  for (const item of buffers) {
    const originalName = (item.name || 'file').replace(/[/\\]/g, '_') || 'file';
    try {
      const buf = Buffer.from(item.dataBase64, 'base64');
      const name = uniqueAttachmentName(dir, originalName);
      const destAbs = join(dir, name);
      writeFileSync(destAbs, buf);
      const rel = `${ATTACHMENTS_DIR}/${name}`;
      out.push(attachmentFromBuffer(name, buf, { path: rel }));
    } catch (err) {
      out.push({
        id: randomUUID(),
        name: originalName,
        kind: 'file',
        content: `(could not attach ${originalName}: ${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }
  return out;
}

/**
 * Build attachments from in-memory buffers without a worktree (create modal).
 */
export function attachmentsFromBuffers(buffers: ComposerFileBuffer[]): ThreadAttachment[] {
  return buffers.map((item) => {
    const name = (item.name || 'file').replace(/[/\\]/g, '_') || 'file';
    try {
      const buf = Buffer.from(item.dataBase64, 'base64');
      return attachmentFromBuffer(name, buf, { sourceLabel: name });
    } catch (err) {
      return {
        id: randomUUID(),
        name,
        kind: 'file',
        content: `(could not attach ${name}: ${err instanceof Error ? err.message : String(err)})`,
      };
    }
  });
}

/**
 * Attach existing worktree-relative files (e.g. drag from the file tree).
 */
export function attachmentsFromWorktreePaths(
  worktreePath: string,
  relativePaths: string[],
): ThreadAttachment[] {
  const out: ThreadAttachment[] = [];
  for (const rel of relativePaths) {
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      out.push({
        id: randomUUID(),
        name: basename(rel) || 'file',
        kind: 'file',
        content: `(invalid path: ${rel})`,
      });
      continue;
    }
    const name = basename(rel);
    try {
      const abs = join(worktreePath, rel);
      const st = statSync(abs);
      if (!st.isFile()) continue;
      const buf = readFileSync(abs);
      out.push(attachmentFromBuffer(name, buf, { path: rel, sourceLabel: abs }));
    } catch (err) {
      out.push({
        id: randomUUID(),
        name,
        kind: 'file',
        content: `(could not read ${rel}: ${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }
  return out;
}
