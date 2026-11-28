import { findLiveThreadForCreate, type LiveCreateMatchThread } from '../board/home-board.js';
import { listPrs } from '../git/worktree.js';
import { loadAppSettings, resolveProjectReviewLabel } from '../store/app-settings.js';
import { isGlobalThread } from '../store/global-workspace.js';
import { listThreads } from '../store/thread-store.js';
import { isRemovedWorkspace, listWorkspaces } from '../store/workspaces.js';
import type { PrInfo } from '../types/thread.js';

/**
 * Open pull requests waiting on this person's review.
 * Same surface as `list_prs` queue=mine (`review-requested:@me`, drafts excluded).
 * Polled on the phone board sync. Not part of the push watch, which only diffs chats.
 */
export interface PhoneReviewPr {
  repoPath: string;
  repoName: string;
  number: number;
  title: string;
  url: string;
  /** Live chat on the checkout for this PR, when one already exists. */
  chatId?: string;
}

export interface PhoneReviewPrSnapshot {
  prs: PhoneReviewPr[];
  error?: string;
  /** False until the first poll finishes. The phone shows a checking line until then. */
  ready: boolean;
}

const EMPTY: PhoneReviewPrSnapshot = { prs: [], ready: false };

let snapshot: PhoneReviewPrSnapshot = EMPTY;
let inflight: Promise<PhoneReviewPrSnapshot> | null = null;

export function phoneReviewPrSnapshot(): PhoneReviewPrSnapshot {
  return snapshot;
}

export function resetPhoneReviewPrSnapshot(): void {
  snapshot = EMPTY;
  inflight = null;
}

/** Fields `listPhoneSidebar` spreads. Omitted until the first poll so a file change is not a false empty. */
export function phoneReviewPrFields(): {
  reviews?: PhoneReviewPr[];
  reviewsError?: string;
  reviewsReady?: boolean;
} {
  if (!snapshot.ready && snapshot.prs.length === 0 && !snapshot.error) return {};
  return {
    reviews: snapshot.prs,
    reviewsReady: snapshot.ready,
    ...(snapshot.error ? { reviewsError: snapshot.error } : {}),
  };
}

function repoName(repoPath: string): string {
  return repoPath.replace(/\/$/, '').split('/').pop() || repoPath;
}

function isProjectPath(path: string): boolean {
  if (!path || path === '/' || path === '.') return false;
  return !isGlobalThread({ repoPath: path });
}

/** Registered projects plus any repo that already has a chat. */
export function phoneReviewRepos(): Array<{ path: string; name: string }> {
  const byPath = new Map<string, string>();
  const add = (path: string) => {
    const trimmed = path.trim();
    if (!isProjectPath(trimmed) || isRemovedWorkspace(trimmed)) return;
    if (!byPath.has(trimmed)) byPath.set(trimmed, repoName(trimmed));
  };
  for (const workspace of listWorkspaces()) add(workspace.path);
  for (const thread of listThreads()) add(thread.repoPath);
  return [...byPath.entries()]
    .map(([path, name]) => ({ path, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

type ListedReviewPr = Pick<PrInfo, 'number' | 'title' | 'url' | 'headRefName' | 'isDraft'>;

export interface PhoneReviewPrDeps {
  repos: () => Array<{ path: string; name: string }>;
  listMine: (repoPath: string) => Promise<ListedReviewPr[]>;
  threads: () => LiveCreateMatchThread[];
}

function defaultDeps(): PhoneReviewPrDeps {
  return {
    repos: phoneReviewRepos,
    threads: () => listThreads(),
    listMine: async (repoPath) => {
      const reviewLabel = resolveProjectReviewLabel(loadAppSettings(), repoPath);
      return listPrs(repoPath, {
        queue: 'mine',
        limit: 40,
        strict: true,
        ...(reviewLabel ? { reviewLabel } : {}),
      });
    },
  };
}

function reviewError(failed: string[], total: number): string | undefined {
  if (failed.length === 0 || total === 0) return undefined;
  if (failed.length === total) return "Couldn't load pull requests waiting on your review.";
  if (failed.length === 1) return `Couldn't load reviews for ${failed[0]}.`;
  return `Couldn't load reviews for ${failed.length} projects.`;
}

export async function refreshPhoneReviewPrs(
  deps: PhoneReviewPrDeps = defaultDeps(),
): Promise<PhoneReviewPrSnapshot> {
  if (inflight) return inflight;
  inflight = loadPhoneReviewPrs(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function loadPhoneReviewPrs(deps: PhoneReviewPrDeps): Promise<PhoneReviewPrSnapshot> {
  const repos = deps.repos();
  const threads = deps.threads();
  const prs: PhoneReviewPr[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < repos.length) {
      const repo = repos[cursor];
      cursor += 1;
      if (!repo) continue;
      try {
        const rows = await deps.listMine(repo.path);
        for (const row of rows) {
          if (row.isDraft || !Number.isFinite(row.number) || row.number <= 0) continue;
          const url = row.url.trim();
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const match = findLiveThreadForCreate(
            {
              sourceType: 'pr',
              sourceRef: String(row.number),
              repoPath: repo.path,
              title: row.title,
              prUrl: url,
              headRefName: row.headRefName,
            },
            threads,
          );
          prs.push({
            repoPath: repo.path,
            repoName: repo.name,
            number: row.number,
            title: row.title.trim() || `Pull request #${row.number}`,
            url,
            ...(match ? { chatId: match.id } : {}),
          });
        }
      } catch {
        failed.push(repo.name);
      }
    }
  };
  const width = Math.min(4, repos.length);
  if (width > 0) await Promise.all(Array.from({ length: width }, () => worker()));
  prs.sort((a, b) => a.repoName.localeCompare(b.repoName) || b.number - a.number);
  const error = reviewError(failed, repos.length);
  snapshot = { prs, ready: true, ...(error ? { error } : {}) };
  return snapshot;
}
