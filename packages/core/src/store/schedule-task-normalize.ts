import type { ThreadAttachment } from '../types/thread.js';
import type { ScheduleRunRecord } from './schedules.js';

const ATTACHMENT_KINDS = new Set<ThreadAttachment['kind']>([
  'transcript',
  'file',
  'issue',
  'workspace',
  'diff-comment',
  'code-ref',
]);

export function normalizeAttachments(raw: unknown): ThreadAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as ThreadAttachment;
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    if (typeof row.name !== 'string' || !row.name) continue;
    if (typeof row.content !== 'string') continue;
    if (!ATTACHMENT_KINDS.has(row.kind)) continue;
    const next: ThreadAttachment = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      content: row.content,
    };
    if (typeof row.path === 'string' && row.path) next.path = row.path;
    if (typeof row.previewDataUrl === 'string' && row.previewDataUrl) {
      next.previewDataUrl = row.previewDataUrl;
    }
    out.push(next);
  }
  return out;
}

export function normalizeRunList(raw: unknown, limit: number): ScheduleRunRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduleRunRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { at?: unknown; threadId?: unknown; error?: unknown };
    if (typeof row.at !== 'string' || !row.at.trim()) continue;
    const next: ScheduleRunRecord = {
      at: row.at,
      threadId:
        typeof row.threadId === 'string' && row.threadId.trim() ? row.threadId.trim() : null,
    };
    if (typeof row.error === 'string' && row.error.trim()) next.error = row.error;
    out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}
