import { getAbleTimeIssueBlockedBy } from '../integrations/abletime-blocked.js';
import { getGitHubIssueBlockedBy } from '../integrations/github-blocked.js';
import { getLinearIssueBlockedBy } from '../integrations/linear-blocked.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  resolveEffectiveIssueSource,
  type IssueSource,
} from '../store/app-settings.js';
import { findThreadByRef, readThread, updateThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';

/** Ticket id stored on a worktree created from an issue. */
export function sourceTicketRef(thread: {
  sourceType?: string | null;
  sourceRef?: string | null;
}): string | null {
  if (thread.sourceType !== 'ticket') return null;
  const ref = (thread.sourceRef ?? '').trim();
  return ref || null;
}

/** True when the stored ids and the fresh lookup are the same set. */
export function sameIssueBlockedBy(current: string[] | undefined, next: string[]): boolean {
  const left = new Set(
    (current ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  const right = [...new Set(next.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  if (left.size !== right.length) return false;
  return right.every((id) => left.has(id));
}

const TRACKER_KEY = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

function isGitHubIssueRef(ref: string): boolean {
  return (
    /^#?\d+$/.test(ref) ||
    /^gh-\d+$/i.test(ref) ||
    /github\.com\/[^/]+\/[^/]+\/issues\/\d+/i.test(ref)
  );
}

/**
 * Which tracker owns this source ticket. Linear and AbleTime ids look like
 * `ENG-123`; a GitHub number never does. A Linear-shaped id still queries
 * Linear when that account is connected, even if the preference is GitHub.
 */
export function trackerForSourceTicket(
  ref: string,
  preferred: IssueSource,
  connected: { linear: boolean; abletime: boolean },
): IssueSource | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (isGitHubIssueRef(trimmed)) return 'github';
  if (TRACKER_KEY.test(trimmed)) {
    if (preferred === 'abletime' && connected.abletime) return 'abletime';
    if (connected.linear) return 'linear';
    if (connected.abletime) return 'abletime';
    return null;
  }
  if (preferred === 'linear' && connected.linear) return 'linear';
  if (preferred === 'abletime' && connected.abletime) return 'abletime';
  if (preferred === 'github') return 'github';
  return null;
}

export type IssueBlockedLookup = {
  preferredSource: () => IssueSource;
  linearConnected: () => boolean;
  abletimeConnected: () => boolean;
  linear: (id: string) => Promise<string[]>;
  github: (id: string, repoPath: string) => Promise<string[]>;
  abletime: (id: string) => Promise<string[]>;
};

export function defaultIssueBlockedLookup(): IssueBlockedLookup {
  return {
    preferredSource: () => resolveEffectiveIssueSource(),
    linearConnected: () => isLinearConnected(),
    abletimeConnected: () => isAbleTimeConnected(),
    linear: (id) => getLinearIssueBlockedBy(id),
    github: (id, repoPath) => getGitHubIssueBlockedBy(id, { repoPath }),
    abletime: (id) => getAbleTimeIssueBlockedBy(id),
  };
}

/**
 * Blocking issue ids for a worktree's source ticket.
 * `null` means the lookup did not run or failed — leave the stored list alone.
 * `[]` means the ticket was read and nothing blocks it.
 */
export async function lookupIssueBlockedBy(
  thread: {
    sourceType?: string | null;
    sourceRef?: string | null;
    repoPath?: string | null;
    worktreePath?: string | null;
  },
  lookup: IssueBlockedLookup = defaultIssueBlockedLookup(),
): Promise<string[] | null> {
  const ref = sourceTicketRef(thread);
  if (!ref) return null;
  const tracker = trackerForSourceTicket(ref, lookup.preferredSource(), {
    linear: lookup.linearConnected(),
    abletime: lookup.abletimeConnected(),
  });
  if (!tracker) return null;
  try {
    if (tracker === 'linear') return await lookup.linear(ref);
    if (tracker === 'abletime') return await lookup.abletime(ref);
    const repo = (thread.repoPath || thread.worktreePath || '').trim();
    return await lookup.github(ref, repo);
  } catch {
    return null;
  }
}

/**
 * Look up the source ticket's blockers and store them on every chat in the
 * worktree. A failed lookup leaves the previous list in place. An empty list
 * means the ticket was read and nothing blocks it.
 */
export async function refreshWorktreeIssueBlocked(
  threadRef: string,
): Promise<string[] | null> {
  const thread = readThread(threadRef) ?? findThreadByRef(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);
  const ids = await lookupIssueBlockedBy(thread);
  if (ids == null) return null;
  const siblings = thread.worktreePath ? threadsSharingWorktree(thread.worktreePath) : [];
  const targets = siblings.length > 0 ? siblings : [thread];
  for (const t of targets) {
    if (sameIssueBlockedBy(t.issueBlockedBy, ids)) continue;
    updateThread(t.id, { issueBlockedBy: ids });
  }
  return ids;
}
