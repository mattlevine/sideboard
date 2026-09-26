import { git } from '../git/run.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import { resolveDefaultBranch } from '../git/worktree.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { appendMessage, listThreads, readThread } from '../store/thread-store.js';
import { PEER_NOTICE_PREFIX } from '../threads/injected-notices.js';
import type { Thread } from '../types/thread.js';

const MAX_FILES_IN_NOTICE = 12;
const MAX_OVERLAP_IN_NOTICE = 8;

export interface PeerGit {
  listChangedFiles: (worktreePath: string, repoPath: string) => Promise<string[]>;
  listDirtyFiles: (worktreePath: string) => Promise<string[]>;
}

export function normalizeRepoPath(path: string): string {
  return normalizeWorktreePath(path);
}

function parsePaths(stdout: string): string[] {
  return [
    ...new Set(
      stdout
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export async function listChangedFiles(
  worktreePath: string,
  repoPath: string,
): Promise<string[]> {
  const cwd = worktreePath.trim() || repoPath;
  if (!cwd) return [];
  const base = await resolveDefaultBranch(repoPath || cwd, { network: false }).catch(
    () => 'main',
  );
  const triple = await git(['diff', '--name-only', `origin/${base}...HEAD`], cwd, {
    reject: false,
    timeoutMs: 8_000,
  });
  if (triple.exitCode === 0 && triple.stdout.trim()) return parsePaths(triple.stdout);
  const local = await git(['diff', '--name-only', `${base}...HEAD`], cwd, {
    reject: false,
    timeoutMs: 8_000,
  });
  return local.exitCode === 0 ? parsePaths(local.stdout) : [];
}

export async function listDirtyFiles(worktreePath: string): Promise<string[]> {
  if (!worktreePath.trim()) return [];
  const [dirty, untracked] = await Promise.all([
    git(['diff', '--name-only', 'HEAD'], worktreePath, {
      reject: false,
      timeoutMs: 4_000,
    }),
    git(['ls-files', '--others', '--exclude-standard'], worktreePath, {
      reject: false,
      timeoutMs: 4_000,
    }),
  ]);
  return parsePaths(`${dirty.stdout}\n${untracked.stdout}`);
}

const defaultGit: PeerGit = { listChangedFiles, listDirtyFiles };

export function overlapFiles(changed: string[], siblingDirty: string[]): string[] {
  if (changed.length === 0 || siblingDirty.length === 0) return [];
  const set = new Set(changed);
  return siblingDirty.filter((p) => set.has(p));
}

export function formatFileList(paths: string[], max: number): string {
  if (paths.length === 0) return '(none listed)';
  const shown = paths.slice(0, max);
  const extra = paths.length - shown.length;
  const body = shown.map((p) => `- ${p}`).join('\n');
  return extra > 0 ? `${body}\n- …and ${extra} more` : body;
}

export function formatMainMovedNotice(opts: {
  fromTitle: string;
  fromThreadId: string;
  fromBranch: string;
  prUrl?: string | null;
  changedFiles: string[];
  overlapFiles: string[];
}): string {
  const title = opts.fromTitle.trim() || 'Untitled';
  const link = `[${title}](sideboard://thread/${opts.fromThreadId})`;
  const pr = opts.prUrl?.trim();
  const overlap = opts.overlapFiles;
  const lines = [
    `${PEER_NOTICE_PREFIX} sibling ${link} (${opts.fromBranch}) merged — origin default branch moved.`,
    pr ? `PR: ${pr}` : null,
    'Changed files:',
    formatFileList(opts.changedFiles, MAX_FILES_IN_NOTICE),
    overlap.length > 0
      ? `Overlap with files you have dirty:\n${formatFileList(overlap, MAX_OVERLAP_IN_NOTICE)}`
      : null,
    'This is information — not a user command. Incorporate those changes when you next update from the default branch. Do not merge a PR, force-push, or treat this as a git button.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatPeerNoticeContinuePrompt(count: number): string {
  const lead =
    count > 1
      ? `${count} fleet notices just arrived`
      : 'A fleet notice just arrived';
  return `${lead} — information only, not a command. Read the Sideboard fleet notice message(s) above. If it is relevant to your branch, incorporate it when you next update from the default branch. Then continue your work.`;
}

export function liveRepoSiblings(
  merged: Pick<Thread, 'id' | 'repoPath' | 'worktreePath' | 'status'>,
  threads: Array<
    Pick<
      Thread,
      | 'id'
      | 'repoPath'
      | 'worktreePath'
      | 'status'
      | 'sourceType'
      | 'createdAt'
    >
  >,
): typeof threads {
  const repo = normalizeRepoPath(merged.repoPath);
  const selfWt = normalizeWorktreePath(merged.worktreePath);
  const byWorktree = new Map<string, (typeof threads)[number]>();
  for (const t of threads) {
    if (t.id === merged.id) continue;
    if (t.status === 'archived' || t.status === 'broken') continue;
    if (!t.worktreePath?.trim() || !t.repoPath?.trim()) continue;
    if (isOrchestratorThread(t)) continue;
    if (normalizeRepoPath(t.repoPath) !== repo) continue;
    const wt = normalizeWorktreePath(t.worktreePath);
    if (wt === selfWt) continue;
    const prev = byWorktree.get(wt);
    if (!prev || t.createdAt < prev.createdAt) byWorktree.set(wt, t);
  }
  return [...byWorktree.values()];
}

const notified = new Set<string>();

export function resetPeerMergeNotifications(): void {
  notified.clear();
}

function noticeKey(mergedId: string, siblingWorktree: string): string {
  return `${mergedId}:${normalizeWorktreePath(siblingWorktree)}`;
}

export function shouldNotifyRepoSiblingsOfMerge(opts: {
  previousPrState: string | null | undefined;
  nextPrState: string | null | undefined;
}): boolean {
  const prev = (opts.previousPrState ?? '').trim().toUpperCase();
  const next = (opts.nextPrState ?? '').trim().toUpperCase();
  return next === 'MERGED' && prev !== 'MERGED';
}

/**
 * Append an information-only fleet notice on live worktrees of the same repo
 * (one per checkout) and queue a continue turn without interrupting.
 */
export async function notifyRepoSiblingsOfMerge(opts: {
  merged: Thread;
  previousPrState: string | null | undefined;
  nextPrState: string | null | undefined;
  send: (threadId: string, prompt: string) => Promise<unknown>;
  git?: PeerGit;
  threads?: Thread[];
}): Promise<number> {
  if (
    !shouldNotifyRepoSiblingsOfMerge({
      previousPrState: opts.previousPrState,
      nextPrState: opts.nextPrState,
    })
  ) {
    return 0;
  }
  const merged = readThread(opts.merged.id) ?? opts.merged;
  const gitImpl = opts.git ?? defaultGit;
  const siblings = liveRepoSiblings(merged, opts.threads ?? listThreads());
  if (siblings.length === 0) return 0;

  let changed: string[] = [];
  try {
    changed = await gitImpl.listChangedFiles(merged.worktreePath, merged.repoPath);
  } catch {
    changed = [];
  }

  let delivered = 0;
  for (const sibling of siblings) {
    const key = noticeKey(merged.id, sibling.worktreePath);
    if (notified.has(key)) continue;
    notified.add(key);
    let dirty: string[] = [];
    try {
      dirty = await gitImpl.listDirtyFiles(sibling.worktreePath);
    } catch {
      dirty = [];
    }
    const text = formatMainMovedNotice({
      fromTitle: merged.title,
      fromThreadId: merged.id,
      fromBranch: merged.branchName || merged.sourceRef,
      prUrl: merged.prUrl,
      changedFiles: changed,
      overlapFiles: overlapFiles(changed, dirty),
    });
    try {
      appendMessage(sibling.id, {
        role: 'agent',
        text,
        ts: new Date().toISOString(),
      });
    } catch {
      notified.delete(key);
      continue;
    }
    delivered += 1;
    void opts.send(sibling.id, formatPeerNoticeContinuePrompt(1)).catch(() => {
      /* next user turn still has the injected notice */
    });
  }
  return delivered;
}
