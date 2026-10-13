import { getOrchestrator } from '../orchestrator/orchestrator.js';
import type { DiffCommit, DiffScope, DiffScopeStat, Thread } from '../types/thread.js';

export type PhonePaneId = 'files' | 'changes' | 'checks';

/** Same filters as the desktop Changes menu. */
export type PhoneChangeScope = DiffScope;

export const PHONE_CHANGE_SCOPES = ['last_turn', 'uncommitted', 'staged', 'unstaged', 'commits'] as const;

/** All commits on the branch, including uncommitted edits. Same default as the desktop sidebar. */
export const PHONE_CHANGE_SCOPE_DEFAULT: PhoneChangeScope = 'commits';

export function phoneChangeScope(value: unknown): PhoneChangeScope | undefined {
  return typeof value === 'string' && (PHONE_CHANGE_SCOPES as readonly string[]).includes(value)
    ? (value as PhoneChangeScope)
    : undefined;
}

export function phoneCommitSha(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{4,40}$/i.test(value) ? value : undefined;
}

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
  /** Changes filter. Omitted means all commits on the branch. */
  scope?: PhoneChangeScope;
  /** One commit when scope is commits. Omitted means every commit on the branch. */
  commitSha?: string;
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
  /** Echoed Changes filter so the phone can drop a stale reply. */
  scope?: PhoneChangeScope;
  commitSha?: string | null;
  hasLastTurnBase?: boolean;
  commits?: DiffCommit[];
  scopeStats?: Record<PhoneChangeScope, DiffScopeStat>;
};

const MAX_ROWS = 200;
const MAX_QUERY = 200;

export function parsePhonePane(value: unknown, chatId: string): PhonePaneRequest | 'invalid' {
  const pane = value && typeof value === 'object' ? (value as { pane?: unknown }).pane : undefined;
  if (pane !== 'files' && pane !== 'changes' && pane !== 'checks') return 'invalid';
  const scope = phoneChangeScope((value as { scope?: unknown }).scope);
  const commitSha = phoneCommitSha((value as { commitSha?: unknown }).commitSha);
  const queryRaw = (value as { query?: unknown }).query;
  const query = typeof queryRaw === 'string' ? queryRaw.trim().slice(0, MAX_QUERY) : '';
  return {
    op: 'pane',
    chatId,
    pane,
    ...(scope && pane === 'changes' ? { scope } : {}),
    ...(commitSha && pane === 'changes' && scope === 'commits' ? { commitSha } : {}),
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
  scope?: PhoneChangeScope,
  query?: string,
  commitSha?: string,
): Promise<Omit<PhonePaneReply, 'op' | 'chatId' | 'pane'>> {
  try {
    if (pane === 'files') return await readFiles(thread.id, query);
    if (pane === 'changes') return await readChanges(thread.id, scope ?? PHONE_CHANGE_SCOPE_DEFAULT, commitSha);
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
  scope: PhoneChangeScope,
  commitSha?: string,
): Promise<Omit<PhonePaneReply, 'op' | 'chatId' | 'pane'>> {
  const diff = await getOrchestrator().diff(threadId, {
    includePatches: false,
    scope,
    commitSha: scope === 'commits' ? (commitSha ?? null) : null,
  });
  const shown = diff.files.slice(0, MAX_ROWS);
  const selected = diff.commits.find((commit) => commit.sha === commitSha || commit.shortSha === commitSha);
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
    scope: diff.scope,
    commitSha: selected?.sha ?? null,
    hasLastTurnBase: diff.hasLastTurnBase,
    commits: diff.commits.slice(0, 40),
    scopeStats: diff.scopeStats,
  };
}

function changeDetail(additions?: number, deletions?: number): string | undefined {
  const add = additions ?? 0;
  const del = deletions ?? 0;
  if (add === 0 && del === 0) return undefined;
  return `+${add} −${del}`;
}

/** One file's unified patch, using the same Changes filter as the list. */
export async function readPhoneChangePatch(
  threadId: string,
  path: string,
  scope: PhoneChangeScope = PHONE_CHANGE_SCOPE_DEFAULT,
  commitSha?: string,
): Promise<{ content: string; truncated: boolean } | null> {
  const diff = await getOrchestrator().diff(threadId, {
    path,
    scope,
    commitSha: scope === 'commits' ? (commitSha ?? null) : null,
    includePatches: true,
    includeMeta: false,
    includeUntracked:
      scope === 'uncommitted' || scope === 'unstaged' || scope === 'last_turn' || (scope === 'commits' && !commitSha),
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
