/** Mirrors PhonePaneRow in packages/core. The phone app does not import core. */
export type PhonePaneId = 'files' | 'changes' | 'checks';

/**
 * A refresh of the chat already on screen must not pull Files, Changes, Checks,
 * or an open document back to the transcript.
 */
export function keepPaneOnOpenedChat(pane: string, sameChat: boolean): boolean {
  return sameChat && pane !== 'chat';
}

/** Same filters as the desktop Changes menu. */
export type PhoneChangeScope = 'last_turn' | 'uncommitted' | 'staged' | 'unstaged' | 'commits';

export type PhoneChangeCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  relativeTime: string;
};

export type PhoneChangeStat = {
  files: number;
  additions: number;
  deletions: number;
};

export type PhonePaneRow = {
  label: string;
  path?: string;
  /** Git name-status letter (M/A/D/…). Changes rows only. */
  status?: string;
  detail?: string;
  href?: string;
};

export type PhoneSide = {
  pane: PhonePaneId;
  rows: PhonePaneRow[];
  note?: string;
  loading?: boolean;
  scope?: PhoneChangeScope;
  commitSha?: string | null;
  /** Merge-base label for All Commits, same as the desktop empty state. */
  base?: string;
  hasLastTurnBase?: boolean;
  commits?: PhoneChangeCommit[];
  scopeStats?: Partial<Record<PhoneChangeScope, PhoneChangeStat>>;
};

/** A Changes reply for another scope or commit must not replace the list in flight. */
export function staleChangeReply(
  wanted: { scope?: PhoneChangeScope; commitSha?: string | null },
  reply: { scope?: PhoneChangeScope; commitSha?: string | null },
): boolean {
  if (wanted.scope && reply.scope && wanted.scope !== reply.scope) return true;
  return (wanted.commitSha || null) !== (reply.commitSha || null);
}

/** Empty Changes copy. All Commits is a diff against the base, not “no commits.” */
export function emptyChangesNote(
  scope: PhoneChangeScope,
  commitSha?: string | null,
  base?: string | null,
): string {
  if (scope === 'uncommitted') return 'No uncommitted changes';
  if (scope === 'staged') return 'No staged changes';
  if (scope === 'unstaged') return 'No unstaged changes';
  if (scope === 'last_turn') return 'No changes in the last agent turn';
  if (commitSha) return 'No changes in this commit';
  return `No changes vs ${base || 'the branch base'}`;
}
