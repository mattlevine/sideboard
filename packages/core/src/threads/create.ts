import { existsSync } from 'node:fs';
import { requireAgent } from '../detect/detect.js';
import {
  allocateTeamSlug,
  createThreadWorktree,
  fetchPrHead,
  getPr,
  resolveDefaultBranch,
  resolveRepoRoot,
} from '../git/worktree.js';
import { copyConfiguredFiles, runSetupScript } from '../hook/conductor.js';
import { runCursorWorktreeSetup } from '../hook/cursor-worktrees.js';
import {
  createEmptyThread,
  readThread,
  updateThread,
  writeThread,
} from '../store/thread-store.js';
import { ensureWorkspace } from '../store/workspaces.js';
import type {
  AgentKind,
  CreateThreadInput,
  Thread,
} from '../types/thread.js';

export async function createThread(
  input: CreateThreadInput,
  onSetupLine?: (line: string) => void,
): Promise<Thread> {
  // Tickets no longer require agent Linear MCP — Sideboard Account owns
  // Linear/GitHub issue connections (see integrations/).
  await requireAgent(input.agent);

  const repoPath = await resolveRepoRoot(input.repoPath);
  if (!existsSync(repoPath)) {
    throw new Error(`Repo not found: ${repoPath}`);
  }

  let sourceRef = input.sourceRef;
  let sourceIsFork = false;

  let prUrl: string | null = null;
  if (input.sourceType === 'pr') {
    const num = Number(input.sourceRef.replace(/^#/, ''));
    if (!Number.isFinite(num)) throw new Error(`Invalid PR number: ${input.sourceRef}`);
    const pr = await getPr(repoPath, num);
    if (!pr) throw new Error(`PR #${num} not found`);
    sourceIsFork = pr.isCrossRepository;
    prUrl = pr.url;
    const localFetchBranch = `sideboard-pr-${pr.number}`;
    await fetchPrHead(repoPath, pr.number, localFetchBranch);
    sourceRef = localFetchBranch;
  } else if (input.sourceType === 'ticket') {
    // Tickets always branch from the repo default (origin tip after fetch).
    sourceRef = await resolveDefaultBranch(repoPath);
  } else if (input.sourceType === 'branch') {
    // Quick create / "default branch" → repo default (usually main).
    // createThreadWorktree then forks from origin/<default>, not a stale local tip.
    if (!sourceRef || sourceRef === 'HEAD' || sourceRef === 'default') {
      sourceRef = await resolveDefaultBranch(repoPath);
    }
  } else if (input.sourceType === 'adopt') {
    throw new Error('Use adoptThread() for adopt sources');
  }

  // Conductor-style: worktree dir + placeholder branch = soccer team.
  // Sidebar later shows renamed branch / PR title (not the create prompt).
  const team = allocateTeamSlug(repoPath);
  const { branchName, worktreePath } = await createThreadWorktree({
    repoPath,
    sourceRef,
    slug: team.slug,
  });

  copyConfiguredFiles(repoPath, worktreePath);

  const explicitTitle = input.title?.trim();
  // Persist immediately so the UI sees the thread even if setup is slow/fails.
  // (Previously setup ran first — `pnpm install` could leave orphan branches.)
  const thread = createEmptyThread({
    title: explicitTitle || team.name,
    userSetTitle: Boolean(explicitTitle),
    sourceType: input.sourceType,
    sourceRef: input.sourceRef === 'default' ? sourceRef : input.sourceRef,
    branchName,
    worktreePath,
    repoPath,
    agent: input.agent,
    autonomy: input.autonomy ?? 'default',
    model: input.model ?? null,
    fast: Boolean(input.fast),
    planMode: Boolean(input.planMode),
    attachments: input.attachments ?? [],
    sourceIsFork,
    parentThreadId: input.parentThreadId ?? null,
    status: 'idle',
    prUrl,
  });
  writeThread(thread);
  await ensureWorkspace(repoPath);

  try {
    let setup = await runSetupScript(repoPath, worktreePath, onSetupLine);
    if (!setup.ran) {
      setup = await runCursorWorktreeSetup(repoPath, worktreePath, onSetupLine);
    }
    if (setup.ran && setup.exitCode !== 0 && setup.exitCode !== null) {
      updateThread(thread.id, {
        lastError: `Setup exited ${setup.exitCode} (thread is still usable)`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateThread(thread.id, {
      lastError: `Setup failed: ${message}`,
    });
  }

  return readThread(thread.id) ?? thread;
}

/** @deprecated Prefer listIssues() from integrations/issues — agent-agnostic. */
export async function listLinearIssues(agent: AgentKind, repoPath: string) {
  const { getAdapter } = await import('../agents/index.js');
  await requireAgent(agent, { requireLinear: true });
  const adapter = getAdapter(agent);
  if (!adapter.listLinearIssues) {
    throw new Error(`${agent} does not support Linear issue listing`);
  }
  return adapter.listLinearIssues(repoPath);
}
