import { callAbleTimeTool } from './abletime-mcp.js';
import { looksLikeAbleTimeUlid } from './abletime-rest.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return '';
}

function firstRecord(
  record: Record<string, unknown> | null,
  keys: string[],
): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function identifierFromUnknown(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    return id ? [id] : [];
  }
  if (Array.isArray(value)) return value.flatMap(identifierFromUnknown);
  const rec = asRecord(value);
  if (!rec) return [];
  for (const key of ['nodes', 'data', 'tasks', 'items']) {
    if (Array.isArray(rec[key])) return identifierFromUnknown(rec[key]);
  }
  const id = firstString(rec, ['identifier', 'reference', 'ref', 'key', 'code', 'number', 'id']);
  return id ? [id] : [];
}

/** Wait-on ids from an AbleTime task payload (`blocked_by` / `depends_on`). */
export function ableTimeBlockedByIdentifiers(raw: unknown): string[] {
  const record = asRecord(raw);
  const nested = firstRecord(record, ['task', 'data']) ?? record;
  if (!nested) return [];
  const value =
    nested.blocked_by ??
    nested.blockedBy ??
    nested.depends_on ??
    nested.dependsOn ??
    nested.dependencyParentTimeflowTaskId ??
    nested.wait_on ??
    nested.waitOn;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of identifierFromUnknown(value)) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function taskReference(raw: unknown): string {
  const record = asRecord(raw);
  const nested = firstRecord(record, ['task', 'data']) ?? record;
  return firstString(nested, ['taskRef', 'reference', 'identifier']);
}

/**
 * Blocking task refs for one AbleTime task.
 * REST reports the dependency parent as a task id; that id is resolved to its
 * reference. A missing reference throws so a poll does not store a clear list.
 */
export async function getAbleTimeIssueBlockedBy(
  id: string,
  opts?: { token?: string | null; host?: string | null },
): Promise<string[]> {
  const taskId = id.trim();
  if (!taskId) throw new Error('AbleTime task id is required');
  const raw = await callAbleTimeTool('get_task', { id: taskId, task_id: taskId }, opts);
  const out: string[] = [];
  for (const blockerId of ableTimeBlockedByIdentifiers(raw)) {
    if (!looksLikeAbleTimeUlid(blockerId)) {
      out.push(blockerId);
      continue;
    }
    const parent = await callAbleTimeTool('get_task', { id: blockerId, task_id: blockerId }, opts);
    const ref = taskReference(parent);
    if (!ref || looksLikeAbleTimeUlid(ref)) {
      throw new Error(`AbleTime blocker has no reference: ${blockerId}`);
    }
    out.push(ref);
  }
  return out;
}
