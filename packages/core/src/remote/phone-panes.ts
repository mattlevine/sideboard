import { getOrchestrator } from '../orchestrator/orchestrator.js';
import type { Thread } from '../types/thread.js';

export type PhonePaneId = 'files' | 'changes' | 'checks';

export type PhonePaneRow = {
  label: string;
  path?: string;
  /** Git name-status letter (M/A/D/…). Changes rows only. */
  status?: string;
  detail?: string;
  href?: string;
};

export type PhonePaneRequest = {
  op: 'pane';
  chatId: string;
  pane: PhonePaneId;
  /** Changes filter. Omitted means the branch-vs-base view. */
  scope?: 'uncommitted' | 'commits';
  /** All-files path filter. Omitted means the unfiltered list. */
  query?: string;
};

export type PhonePaneReply = {
  op: 'pane';
  chatId: string;
  pane: PhonePaneId;
  rows: PhonePaneRow[];
  note?: string;
  /** Echoed All-files filter so the phone can drop a stale reply. */
  query?: string;
};

const MAX_ROWS = 200;
const MAX_QUERY = 200;

export function parsePhonePane(value: unknown, chatId: string): PhonePaneRequest | 'invalid' {
  const pane = value && typeof value === 'object' ? (value as { pane?: unknown }).pane : undefined;
  if (pane !== 'files' && pane !== 'changes' && pane !== 'checks') return 'invalid';
  const scopeRaw = (value as { scope?: unknown }).scope;
  const scope = scopeRaw === 'uncommitted' || scopeRaw === 'commits' ? scopeRaw : undefined;
  const queryRaw = (value as { query?: unknown }).query;
  const query = typeof queryRaw === 'string' ? queryRaw.trim().slice(0, MAX_QUERY) : '';
  return {
    op: 'pane',
    chatId,
    pane,
    ...(scope && pane === 'changes' ? { scope } : {}),
    ...(query && pane === 'files' ? { query } : {}),
  };
}

/** Case-insensitive path match, same rule as the desktop file tree. */
export function filterPhoneFiles(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;
  return paths.filter((path) => path.toLowerCase().includes(q));
}

/** Files, Changes, and Checks for the phone tab row. Same sources as the desktop sidebar. */
export async function readPhonePane(
  thread: Thread,
  pane: PhonePaneId,
  scope?: 'uncommitted' | 'commits',
  query?: string,
): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  try {
    if (pane === 'files') return await readFiles(thread.id, query);
    if (pane === 'changes') return await readChanges(thread.id, scope ?? 'commits');
    return await readChecks(thread.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { rows: [], note: message };
  }
}

async function readFiles(threadId: string, query?: string): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  const paths = filterPhoneFiles(await getOrchestrator().listFiles(threadId), query ?? '');
  const shown = paths.slice(0, MAX_ROWS);
  const extra = paths.length - shown.length;
  const note =
    extra > 0
      ? query?.trim()
        ? `${extra} more matching files`
        : `${extra} more files on the Mac`
      : undefined;
  return {
    rows: shown.map((path) => ({ label: path, path })),
    ...(note ? { note } : {}),
  };
}

async function readChanges(
  threadId: string,
  scope: 'uncommitted' | 'commits',
): Promise<{ rows: PhonePaneRow[]; note?: string }> {
  const diff = await getOrchestrator().diff(threadId, { includePatches: false, scope });
  const shown = diff.files.slice(0, MAX_ROWS);
  return {
    rows: shown.map((file) => {
      const detail = changeDetail(file.additions, file.deletions);
      return {
        label: file.path,
        path: file.path,
        ...(file.status ? { status: file.status } : {}),
        ...(detail ? { detail } : {}),
      };
    }),
    ...(diff.files.length > shown.length ? { note: `${diff.files.length - shown.length} more changed files` } : {}),
  };
}

function changeDetail(additions?: number, deletions?: number): string | undefined {
  const add = additions ?? 0;
  const del = deletions ?? 0;
  if (add === 0 && del === 0) return undefined;
  return `+${add} −${del}`;
}

/** One file's unified patch, same scope as the phone Changes list (branch vs base). */
export async function readPhoneChangePatch(
  threadId: string,
  path: string,
): Promise<{ content: string; truncated: boolean } | null> {
  const diff = await getOrchestrator().diff(threadId, {
    path,
    scope: 'commits',
    includePatches: true,
    includeMeta: false,
    includeUntracked: false,
  });
  const file = diff.files.find((row) => row.path === path) ?? diff.files[0];
  if (!file) return null;
  const content = file.patch ?? '';
  return { content, truncated: content.includes('… truncated') };
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
