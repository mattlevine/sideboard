/**
 * AbleTime task files — listing from get_task payloads and Account-auth
 * download into `.context/attachments/`. Kept out of abletime.ts for the
 * max-lines ratchet.
 */
import { httpFetch } from '../http/fetch.js';
import {
  getAbleTimeAccessToken,
  getAbleTimeHost,
} from '../store/app-settings.js';
import { assertAbleTimeCredential, normalizeAbleTimeHost } from './abletime-mcp.js';
import { abletimeRestUrl, textFromAbleTimeDoc } from './abletime-rest.js';
import {
  downloadAuthenticatedFile,
  extractHttpUrls,
  hostMatches,
  issueAttachmentWorktreePath,
  looksLikeFileUrl,
  looksLikeHttpUrl,
  mergeIssueAttachments,
  type DownloadedIssueAttachment,
  type IssueVendorAttachment,
} from './issue-attachments.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'tasks', 'projects', 'items', 'results', 'nodes']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return '';
}

export interface AbleTimeDocFile {
  id?: string;
  name: string;
  url: string;
}

/** Image / file nodes in a ProseMirror doc (description or comment). */
export function filesFromAbleTimeDoc(value: unknown): AbleTimeDocFile[] {
  const out: AbleTimeDocFile[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    const rec = asRecord(node);
    if (!rec) return;
    const attrs = asRecord(rec.attrs) ?? rec;
    const url =
      asString(attrs.src) ||
      asString(attrs.href) ||
      asString(attrs.url) ||
      asString(attrs.fileUrl) ||
      asString(attrs.downloadUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push({
        id: asString(attrs.id) || asString(attrs.fileId) || undefined,
        name:
          asString(attrs.name) ||
          asString(attrs.title) ||
          asString(attrs.filename) ||
          asString(attrs.alt) ||
          'attachment',
        url,
      });
    }
    if (Array.isArray(rec.content)) rec.content.forEach(walk);
  };
  walk(value);
  return out;
}

function listedAbleTimeFiles(raw: unknown): IssueVendorAttachment[] {
  const out: IssueVendorAttachment[] = [];
  for (const item of asList(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const url = firstString(rec, ['url', 'href', 'src', 'fileUrl', 'downloadUrl', 'permalink']);
    if (!url) continue;
    const id = firstString(rec, ['id', 'fileId', 'attachmentId']) || url;
    const name =
      firstString(rec, ['name', 'title', 'filename', 'fileName', 'alt']) || 'attachment';
    out.push({ id, name, url });
  }
  return out;
}

export function mapAbleTimeAttachments(record: Record<string, unknown>): IssueVendorAttachment[] {
  const listed = [
    ...listedAbleTimeFiles(record.attachments),
    ...listedAbleTimeFiles(record.files),
    ...listedAbleTimeFiles(record.media),
  ];
  const fromDocs = [
    ...filesFromAbleTimeDoc(record.description),
    ...filesFromAbleTimeDoc(record.content),
    ...asList(record.comments).flatMap((item) => {
      const rec = asRecord(item);
      return rec ? filesFromAbleTimeDoc(rec.content ?? rec.body) : [];
    }),
  ].map((file) => ({
    id: file.id || file.url,
    name: file.name,
    url: file.url,
  }));
  const fromText = extractHttpUrls(
    firstString(record, ['description', 'body', 'descriptionSanitized']) ||
      textFromAbleTimeDoc(record.description),
  )
    .filter(looksLikeFileUrl)
    .map((url) => ({
      id: url,
      name: url.split('/').pop() || 'attachment',
      url,
    }));
  return mergeIssueAttachments([...listed, ...fromDocs, ...fromText]);
}

function ableTimeFileHostSuffixes(host: string): string[] {
  try {
    const hostname = new URL(normalizeAbleTimeHost(host)).hostname.toLowerCase();
    const parts = hostname.split('.');
    const root = parts.slice(-2).join('.');
    return Array.from(new Set([hostname, root, 'abletime.com']));
  } catch {
    return ['abletime.com'];
  }
}

async function resolveAbleTimeAttachmentUrl(
  id: string,
  opts: { token: string; host: string },
): Promise<{ url: string; name?: string }> {
  for (const path of [`/files/${encodeURIComponent(id)}`, `/attachments/${encodeURIComponent(id)}`]) {
    const res = await httpFetch(abletimeRestUrl(path, opts.host), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
    });
    if (!res.ok) continue;
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('json')) continue;
    const json = (await res.json().catch(() => null)) as unknown;
    const rec =
      json && typeof json === 'object' && !Array.isArray(json)
        ? ((json as Record<string, unknown>).data &&
          typeof (json as Record<string, unknown>).data === 'object'
            ? ((json as Record<string, unknown>).data as Record<string, unknown>)
            : (json as Record<string, unknown>))
        : null;
    if (!rec) continue;
    const url =
      firstString(rec, ['url', 'href', 'src', 'fileUrl', 'downloadUrl']) ||
      firstString(asRecord(rec.file), ['url', 'href']);
    if (url) {
      return {
        url,
        name: firstString(rec, ['name', 'title', 'filename', 'fileName']) || undefined,
      };
    }
  }
  throw new Error(`AbleTime attachment not found: ${id}`);
}

/**
 * Download an AbleTime task file into `.context/attachments/` using the Account
 * token. Pass the attachment id or URL from `abletime_get_task`.
 */
export async function downloadAbleTimeAttachment(
  input: { id: string; name?: string },
  opts?: { token?: string | null; host?: string | null; destPath?: string | null },
): Promise<DownloadedIssueAttachment> {
  const id = input.id.trim();
  if (!id) throw new Error('AbleTime attachment id or URL is required');
  const token = assertAbleTimeCredential(opts?.token ?? getAbleTimeAccessToken() ?? '');
  const host = normalizeAbleTimeHost(opts?.host ?? getAbleTimeHost());
  let url = id;
  let name = input.name?.trim();
  if (!looksLikeHttpUrl(id)) {
    const resolved = await resolveAbleTimeAttachmentUrl(id, { token, host });
    url = resolved.url;
    name = name || resolved.name;
  }
  const sendAuth = hostMatches(url, ableTimeFileHostSuffixes(host));
  return downloadAuthenticatedFile({
    url,
    headers: sendAuth ? { Authorization: `Bearer ${token}` } : undefined,
    worktreePath: issueAttachmentWorktreePath(opts?.destPath),
    name,
  });
}
