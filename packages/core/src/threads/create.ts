import { existsSync } from 'node:fs';
import { requireAgent } from '../detect/detect.js';
import {
  allocateTeamSlug,
  createThreadWorktree,
  currentBranch,
  fetchPrHead,
  getPr,
  getPrForHeadBranch,
  resolveDefaultBranch,
  resolveRepoRoot,
} from '../git/worktree.js';
import { copyConfiguredFiles } from '../hook/conductor.js';
import { resolveNewThreadOptions } from '../store/app-settings.js';
import {
  createEmptyThread,
  readThread,
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
  _onSetupLine?: (line: string) => void,
): Promise<Thread> {
  // Tickets no longer require agent Linear MCP — Sideboard Account owns
  // Linear/GitHub issue connections (see integrations/).
  const resolved = resolveNewThreadOptions({
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    fast: input.fast,
  });
  await requireAgent(resolved.agent);

  const repoPath = await resolveRepoRoot(input.repoPath);
  if (!existsSync(repoPath)) {
    throw new Error(`Repo not found: ${repoPath}`);
  }

  if (input.cowboy) {
    const { cowboyModeEnabled } = await import('../store/app-settings.js');
    if (!cowboyModeEnabled()) {
      throw new Error(
        'Cowboy mode is off. Enable it in Settings → Advanced.',
      );
    }
    if (input.sourceType === 'pr' || input.sourceType === 'ticket' || input.sourceType === 'adopt') {
      throw new Error(
        'Cowboy mode works on the project folder (default branch), not a PR, ticket, or adopt.',
      );
    }
    const defaultBranch = await resolveDefaultBranch(repoPath, { network: false });
    const head = await currentBranch(repoPath);
    if (head === 'HEAD') {
      throw new Error(
        'Cowboy mode needs a named branch in the project folder (not a detached HEAD).',
      );
    }
    if (head !== defaultBranch) {
      throw new Error(
        `Cowboy mode uses ${defaultBranch} in the project folder. Switch that checkout to ${defaultBranch} first (currently ${head}).`,
      );
    }
    const explicitTitle = input.title?.trim();
    const thread = createEmptyThread({
      title: explicitTitle || `Cowboy · ${head}`,
      userSetTitle: Boolean(explicitTitle),
      sourceType: 'branch',
      sourceRef: head,
      branchName: head,
      worktreePath: repoPath,
      repoPath,
      agent: resolved.agent,
      autonomy: input.autonomy ?? 'default',
      model: resolved.model,
      effort: resolved.effort,
      fast: resolved.fast,
      planMode: Boolean(input.planMode),
      attachments: input.attachments ?? [],
      sourceIsFork: false,
      parentThreadId: input.parentThreadId ?? null,
      status: 'idle',
      cowboy: true,
    });
    writeThread(thread);
    await ensureWorkspace(repoPath);
    return readThread(thread.id) ?? thread;
  }

  let sourceRef = input.sourceRef;
  let sourceIsFork = false;

  let prUrl: string | null = null;
  let prTitle: string | null = null;
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
    } else {
      // Worktree branch is still thread/<team>. Attach the existing GitHub PR
      // for the source branch so the sidebar matches create-from-PR.
      const existing = await getPrForHeadBranch(repoPath, sourceRef);
      if (existing?.url) {
        prUrl = existing.url;
        prTitle = existing.title;
      }
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
    agent: resolved.agent,
    autonomy: input.autonomy ?? 'default',
    model: resolved.model,
    effort: resolved.effort,
    fast: resolved.fast,
    planMode: Boolean(input.planMode),
    attachments: input.attachments ?? [],
    sourceIsFork,
    parentThreadId: input.parentThreadId ?? null,
    status: 'idle',
    prUrl,
    prTitle,
  });
  writeThread(thread);
  await ensureWorkspace(repoPath);

  // Setup runs via Orchestrator.runSetup after create (settings.toml,
  // .cursor/worktrees.json, or script/setup) in parallel with the first turn.
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
