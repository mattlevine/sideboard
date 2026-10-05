/**
 * Shared helpers for listing and downloading issue-tracker file attachments.
 * Bytes go to `.context/attachments/` — never into an MCP tool result.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { httpFetch } from '../http/fetch.js';
import {
  ATTACHMENTS_DIR,
  attachmentsGitignoreBody,
} from '../paths/workspace-scratch.js';

/** Listed on get_issue / get_task. Download with the matching vendor tool. */
export interface IssueVendorAttachment {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  sourceType?: string;
}

export interface DownloadedIssueAttachment {
  name: string;
  /** Worktree-relative path under `.context/attachments/`. */
  path: string;
  bytes: number;
  contentType?: string;
}

export const ISSUE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(\s*<?(https?:\/\/[^)\s>]+)>?/gi;
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]]*]\(\s*<?(https?:\/\/[^)\s>]+)>?/gi;
const HTML_SRC_RE = /\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"'`)]+/gi;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/zip': '.zip',
};

export function issueAttachmentWorktreePath(repoPath?: string | null): string {
  const raw = (repoPath ?? '').trim();
  return raw || process.cwd();
}

export function ensureIssueAttachmentsDir(worktreePath: string): string {
  const dir = join(worktreePath, ATTACHMENTS_DIR);
  mkdirSync(dir, { recursive: true });
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, attachmentsGitignoreBody(), 'utf8');
  }
  return dir;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function hostMatches(url: string, suffixes: readonly string[]): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** True when the path looks like a file (has an extension), not a ticket page. */
export function looksLikeFileUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\.[a-z0-9]{2,8}$/i.test(path);
  } catch {
    return false;
  }
}

export function filenameFromUrl(url: string, fallback = 'attachment'): string {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(basename(parsed.pathname)).replace(/[/\\]/g, '_');
    if (last && last !== '/' && last !== '.') return last;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function filenameFromContentDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      return star[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  const plain = header.match(/filename\s*=\s*("(?:\\.|[^"])*"|[^;]+)/i);
  if (!plain?.[1]) return undefined;
  return plain[1].trim().replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
}

export function uniqueAttachmentFileName(dir: string, originalName: string): string {
  const safe = originalName.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'file';
  if (!existsSync(join(dir, safe))) return safe;
  const ext = extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}-${randomUUID()}${ext}`;
}

export function extractHttpUrls(markdown: string | undefined | null): string[] {
  const text = markdown ?? '';
  if (!text.trim()) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const url = raw.replace(/[).,;]+$/, '');
    if (!looksLikeHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };
  for (const re of [MARKDOWN_IMAGE_RE, MARKDOWN_LINK_RE, HTML_SRC_RE, BARE_URL_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (match[1]) push(match[1]);
      else if (re === BARE_URL_RE) push(match[0]);
    }
  }
  return found;
}

export function attachmentNameFromUrl(url: string, fallback: string): string {
  const fromUrl = filenameFromUrl(url, '');
  if (fromUrl && fromUrl.includes('.')) return fromUrl;
  return fallback;
}

export function mergeIssueAttachments(
  items: Array<IssueVendorAttachment | null | undefined>,
): IssueVendorAttachment[] {
  const out: IssueVendorAttachment[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item) continue;
    const url = item.url.trim();
    const id = item.id.trim() || url;
    if (!id && !url) continue;
    const key = url || id;
    if (seen.has(key) || seen.has(id)) continue;
    seen.add(key);
    if (id !== key) seen.add(id);
    out.push({
      id: id || url,
      name: item.name.trim() || filenameFromUrl(url),
      url,
      ...(item.contentType ? { contentType: item.contentType } : {}),
      ...(item.sourceType ? { sourceType: item.sourceType } : {}),
    });
  }
  return out;
}

function extensionForContentType(contentType: string | undefined, name: string): string {
  if (extname(name)) return name;
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = EXT_BY_MIME[mime];
  return ext ? `${name}${ext}` : name;
}

function assertNotHtml(contentType: string | undefined, url: string): void {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    throw new Error(
      `Attachment at ${url} returned HTML, not a file. Use the listed file URL (uploads / user-attachments), not a ticket or PR page.`,
    );
  }
}

export async function downloadAuthenticatedFile(opts: {
  url: string;
  headers?: Record<string, string>;
  worktreePath: string;
  name?: string;
}): Promise<DownloadedIssueAttachment> {
  const url = opts.url.trim();
  if (!looksLikeHttpUrl(url)) {
    throw new Error(`Attachment URL must be http(s) (got ${url || 'empty'})`);
  }
  const res = await httpFetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: '*/*',
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Attachment download failed ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''} (${url})`,
    );
  }
  const contentType = res.headers.get('content-type') ?? undefined;
  assertNotHtml(contentType, url);
  const lengthHeader = res.headers.get('content-length');
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > ISSUE_ATTACHMENT_MAX_BYTES) {
      throw new Error(
        `Attachment is ${length} bytes; max is ${ISSUE_ATTACHMENT_MAX_BYTES} (${url})`,
      );
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > ISSUE_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Attachment is ${buf.length} bytes; max is ${ISSUE_ATTACHMENT_MAX_BYTES} (${url})`,
    );
  }
  const dir = ensureIssueAttachmentsDir(opts.worktreePath);
  const hinted =
    opts.name?.trim() ||
    filenameFromContentDisposition(res.headers.get('content-disposition')) ||
    filenameFromUrl(url);
  const name = uniqueAttachmentFileName(dir, extensionForContentType(contentType, hinted));
  writeFileSync(join(dir, name), buf);
  return {
    name,
    path: `${ATTACHMENTS_DIR}/${name}`,
    bytes: buf.length,
    ...(contentType ? { contentType } : {}),
  };
}
