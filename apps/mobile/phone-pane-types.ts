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
  hasLastTurnBase?: boolean;
  commits?: PhoneChangeCommit[];
  scopeStats?: Partial<Record<PhoneChangeScope, PhoneChangeStat>>;
};
