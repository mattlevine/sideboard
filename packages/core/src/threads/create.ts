import { existsSync } from 'node:fs';
import { requireAgent } from '../detect/detect.js';
import {
  allocateTeamSlug,
  canonicalizeRepoPath,
  createThreadWorktree,
  currentBranch,
  fastForwardMainCheckoutIfSafe,
  fetchOriginForWorktree,
  fetchPrHead,
  getPr,
  getPrForHeadBranch,
  resolveDefaultBranch,
  resolveRepoRoot,
} from '../git/worktree.js';
import { findLiveThreadForCreate } from '../board/home-board.js';
import { copyConfiguredFiles } from '../hook/conductor.js';
import {
  getIssueSource,
  isAbleTimeConnected,
  resolveNewThreadOptions,
} from '../store/app-settings.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import {
  createEmptyThread,
  listThreads,
  readThread,
  updateThread,
  writeThread,
} from '../store/thread-store.js';
import { ensureWorkspace } from '../store/workspaces.js';
import type {
  AgentKind,
  CreateThreadInput,
  Thread,
  ThreadAttachment,
} from '../types/thread.js';

function persistCreateAttachments(
  worktreePath: string,
  attachments: ThreadAttachment[] | undefined,
): ThreadAttachment[] {
  return persistPendingFileAttachments(worktreePath, attachments ?? []);
}

function liveThreadsForCreate() {
  return listThreads({ includeArchived: false }).map((t) => ({
    ...t,
    repoPath: canonicalizeRepoPath(t.repoPath),
  }));
}

function reuseLiveThread(
  input: CreateThreadInput,
  repoPath: string,
  match: {
    sourceType: CreateThreadInput['sourceType'];
    sourceRef: string;
    title?: string;
    prUrl?: string;
    headRefName?: string;
  },
): Thread | undefined {
  if (input.reuseExisting === false) return undefined;
  const existing = findLiveThreadForCreate(
    {
      sourceType: match.sourceType,
      sourceRef: match.sourceRef,
      repoPath,
      title: match.title ?? input.title,
      cowboy: input.cowboy,
      prUrl: match.prUrl,
      headRefName: match.headRefName,
    },
    liveThreadsForCreate(),
  );
  if (!existing) return undefined;
  const thread = readThread(existing.id) ?? existing;
  if (!input.attachments?.length) return thread;
  return updateThread(thread.id, {
    attachments: persistCreateAttachments(thread.worktreePath, [
      ...thread.attachments,
      ...input.attachments,
    ]),
  });
}

export async function createThread(
  input: CreateThreadInput,
  _onSetupLine?: (line: string) => void,
): Promise<Thread> {
  const repoPath = await resolveRepoRoot(input.repoPath);
  if (!existsSync(repoPath)) {
    throw new Error(`Repo not found: ${repoPath}`);
  }

  const reused = reuseLiveThread(input, repoPath, {
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    title: input.title,
  });
  if (reused) return reused;

  // Tickets no longer require agent Linear MCP — Sideboard Account owns
  // Linear/GitHub/AbleTime issue connections (see integrations/).
  const resolved = resolveNewThreadOptions({
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    fast: input.fast,
  });
  await requireAgent(resolved.agent);

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
    await fetchOriginForWorktree(repoPath, defaultBranch);
    await fastForwardMainCheckoutIfSafe(repoPath, { branch: defaultBranch });
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
      attachments: persistCreateAttachments(repoPath, input.attachments),
      sourceIsFork: false,
      parentThreadId: input.parentThreadId ?? null,
      status: 'idle',
      cowboy: true,
    });
    writeThread(thread);
    await ensureWorkspace(repoPath);
    return readThread(thread.id) ?? thread;
  }

  let sourceType = input.sourceType;
  let sourceRef = input.sourceRef;
  let persistedSourceRef = input.sourceRef;
  let attachments = input.attachments ?? [];
  let title = input.title;
  let sourceIsFork = false;

  if (
    !input.cowboy &&
    sourceType === 'branch' &&
    (!sourceRef || sourceRef === 'HEAD' || sourceRef === 'default')
  ) {
    if (isAbleTimeConnected() && getIssueSource() === 'abletime') {
      const { ensureAbleTimeTask, issueAttachmentForAbleTimeTask } = await import(
        '../integrations/abletime.js'
      );
      const task = await ensureAbleTimeTask({
        title: title?.trim() || 'Untitled work',
        description: input.prompt?.trim() || undefined,
      });
      sourceType = 'ticket';
      sourceRef = task.identifier;
      persistedSourceRef = task.identifier;
      title = title?.trim() || task.title;
      attachments = [...attachments, issueAttachmentForAbleTimeTask(task)];
      const reusedTicket = reuseLiveThread(
        { ...input, sourceType: 'ticket', sourceRef, title, attachments },
        repoPath,
        { sourceType: 'ticket', sourceRef, title },
      );
      if (reusedTicket) return reusedTicket;
    }
  }

  let prUrl: string | null = null;
  let prTitle: string | null = null;
  if (sourceType === 'pr') {
    const num = Number(input.sourceRef.replace(/^#/, ''));
    if (!Number.isFinite(num)) throw new Error(`Invalid PR number: ${input.sourceRef}`);
    const pr = await getPr(repoPath, num);
    if (!pr) throw new Error(`PR #${num} not found`);
    const reusedPr = reuseLiveThread(input, repoPath, {
      sourceType: 'pr',
      sourceRef: String(pr.number),
      title: input.title ?? pr.title,
      prUrl: pr.url,
      headRefName: pr.headRefName,
    });
    if (reusedPr) return reusedPr;
    sourceIsFork = pr.isCrossRepository;
    prUrl = pr.url;
    const localFetchBranch = `sideboard-pr-${pr.number}`;
    await fetchPrHead(repoPath, pr.number, localFetchBranch);
    sourceRef = localFetchBranch;
  } else if (sourceType === 'ticket') {
    // Tickets always branch from the repo default (origin tip after fetch).
    sourceRef = await resolveDefaultBranch(repoPath);
  } else if (sourceType === 'branch') {
    // Quick create / "default branch" → repo default (usually main).
    // createThreadWorktree fetches origin/<default> and forks from that tip.
    // The project folder is fast-forwarded only when it is on that branch and clean.
    if (!sourceRef || sourceRef === 'HEAD' || sourceRef === 'default') {
      sourceRef = await resolveDefaultBranch(repoPath);
    } else {
      // Worktree branch is still thread/<team>. Attach the existing GitHub PR
      // for the source branch so the sidebar matches create-from-PR.
      const existing = await getPrForHeadBranch(repoPath, sourceRef);
      if (existing) {
        const reusedPr = reuseLiveThread(input, repoPath, {
          sourceType: 'pr',
          sourceRef: String(existing.number),
          title: input.title ?? existing.title,
          prUrl: existing.url,
          headRefName: existing.headRefName,
        });
        if (reusedPr) return reusedPr;
        if (existing.url) {
          prUrl = existing.url;
          prTitle = existing.title;
        }
      }
    }
  } else if (sourceType === 'adopt') {
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

  const explicitTitle = title?.trim();
  // Persist immediately so the UI sees the thread even if setup is slow/fails.
  // (Previously setup ran first — `pnpm install` could leave orphan branches.)
  const thread = createEmptyThread({
    title: explicitTitle || team.name,
    userSetTitle: Boolean(explicitTitle),
    sourceType,
    sourceRef: persistedSourceRef === 'default' ? sourceRef : persistedSourceRef,
    branchName,
    worktreePath,
    repoPath,
    agent: resolved.agent,
    autonomy: input.autonomy ?? 'default',
    model: resolved.model,
    effort: resolved.effort,
    fast: resolved.fast,
    planMode: Boolean(input.planMode),
    attachments: persistCreateAttachments(worktreePath, attachments),
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
