import { getOrchestrator } from '../orchestrator/orchestrator.js';
import type { Thread } from '../types/thread.js';

export type PhonePaneId = 'files' | 'changes' | 'checks';

export type PhonePaneRow = {
  label: string;
  path?: string;
  detail?: string;
  href?: string;
};

export type PhonePaneRequest = {
  op: 'pane';
  chatId: string;
  pane: PhonePaneId;
  /** Changes filter. Omitted means the branch-vs-base view. */
  scope?: 'uncommitted' | 'commits';
};

export type PhonePaneReply = {
  op: 'pane';
  chatId: string;
  pane: PhonePaneId;
  rows: PhonePaneRow[];
  note?: string;
};

const MAX_ROWS = 200;

export function parsePhonePane(value: unknown, chatId: string): PhonePaneRequest | 'invalid' {
  const pane = value && typeof value === 'object' ? (value as { pane?: unknown }).pane : undefined;
  if (pane !== 'files' && pane !== 'changes' && pane !== 'checks') return 'invalid';
  const scopeRaw = (value as { scope?: unknown }).scope;
  const scope = scopeRaw === 'uncommitted' || scopeRaw === 'commits' ? scopeRaw : undefined;
  return { op: 'pane', chatId, pane, ...(scope && pane === 'changes' ? { scope } : {}) };
}

/** Files, Changes, and Checks for the phone tab row. Same sources as the desktop sidebar. */
export async function readPhonePane(
  thread: Thread,
  pane: PhonePaneId,
  scope?: 'uncommitted' | 'commits',
): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  try {
    if (pane === 'files') return await readFiles(thread.id);
    if (pane === 'changes') return await readChanges(thread.id, scope ?? 'commits');
    return await readChecks(thread.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { rows: [], note: message };
  }
}

async function readFiles(threadId: string): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  const paths = await getOrchestrator().listFiles(threadId);
  const shown = paths.slice(0, MAX_ROWS);
  return {
    rows: shown.map((path) => ({ label: path, path })),
    ...(paths.length > shown.length ? { note: `${paths.length - shown.length} more files on the Mac` } : {}),
  };
}

async function readChanges(
  threadId: string,
  scope: 'uncommitted' | 'commits',
): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  const diff = await getOrchestrator().diff(threadId, { includePatches: false, scope });
  const shown = diff.files.slice(0, MAX_ROWS);
  return {
    rows: shown.map((file) => ({
      label: file.path,
      path: file.path,
      detail: changeDetail(file.additions, file.deletions),
    })),
    ...(diff.files.length > shown.length ? { note: `${diff.files.length - shown.length} more changed files` } : {}),
  };
}

function changeDetail(additions?: number, deletions?: number): string | undefined {
  const add = additions ?? 0;
  const del = deletions ?? 0;
  if (add === 0 && del === 0) return undefined;
  return `+${add} −${del}`;
}

async function readChecks(threadId: string): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  const checks = await getOrchestrator().getPrChecks(threadId);
  if (!checks) return { rows: [], note: 'No pull request on this branch.' };
  const shown = checks.slice(0, MAX_ROWS);
  return {
    rows: shown.map((check) => ({
      label: check.name,
      detail: check.bucket || check.state,
      ...(check.link ? { href: check.link } : {}),
    })),
  };
}
