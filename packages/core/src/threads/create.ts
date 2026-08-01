import { existsSync } from 'node:fs';
import { requireAgent } from '../detect/detect.js';
import {
  createThreadWorktree,
  fetchPrHead,
  getPr,
  resolveDefaultBranch,
  resolveRepoRoot,
  suggestSlug,
} from '../git/worktree.js';
import { copyConfiguredFiles, runSetupScript } from '../hook/conductor.js';
import {
  createEmptyThread,
  writeThread,
} from '../store/thread-store.js';
import type {
  AgentKind,
  CreateThreadInput,
  Thread,
} from '../types/thread.js';

export async function createThread(
  input: CreateThreadInput,
  onSetupLine?: (line: string) => void,
): Promise<Thread> {
  await requireAgent(input.agent, {
    requireLinear: input.sourceType === 'ticket',
  });

  const repoPath = await resolveRepoRoot(input.repoPath);
  if (!existsSync(repoPath)) {
    throw new Error(`Repo not found: ${repoPath}`);
  }

  let sourceRef = input.sourceRef;
  let sourceIsFork = false;
  let title = input.title;
  let slugBase = input.sourceRef;

  if (input.sourceType === 'pr') {
    const num = Number(input.sourceRef.replace(/^#/, ''));
    if (!Number.isFinite(num)) throw new Error(`Invalid PR number: ${input.sourceRef}`);
    const pr = await getPr(repoPath, num);
    if (!pr) throw new Error(`PR #${num} not found`);
    sourceIsFork = pr.isCrossRepository;
    title = title ?? `PR #${pr.number}: ${pr.title}`;
    slugBase = `pr-${pr.number}`;
    const localFetchBranch = `sideboard-pr-${pr.number}`;
    await fetchPrHead(repoPath, pr.number, localFetchBranch);
    sourceRef = localFetchBranch;
  } else if (input.sourceType === 'ticket') {
    const key = input.sourceRef.toUpperCase();
    title = title ?? key;
    slugBase = key.toLowerCase();
    sourceRef = await resolveDefaultBranch(repoPath);
  } else if (input.sourceType === 'branch') {
    title = title ?? `Branch ${input.sourceRef}`;
    slugBase = input.sourceRef;
  } else if (input.sourceType === 'adopt') {
    throw new Error('Use adoptThread() for adopt sources');
  }

  const slug = suggestSlug(slugBase);
  const { branchName, worktreePath } = await createThreadWorktree({
    repoPath,
    sourceRef,
    slug,
  });

  copyConfiguredFiles(repoPath, worktreePath);
  await runSetupScript(repoPath, worktreePath, onSetupLine);

  const thread = createEmptyThread({
    title: title ?? branchName,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    branchName,
    worktreePath,
    repoPath,
    agent: input.agent,
    autonomy: input.autonomy ?? 'default',
    sourceIsFork,
    parentThreadId: input.parentThreadId ?? null,
  });

  writeThread(thread);
  return thread;
}

export async function listLinearIssues(agent: AgentKind, repoPath: string) {
  const { getAdapter } = await import('../agents/index.js');
  await requireAgent(agent, { requireLinear: true });
  const adapter = getAdapter(agent);
  if (!adapter.listLinearIssues) {
    throw new Error(`${agent} does not support Linear issue listing`);
  }
  return adapter.listLinearIssues(repoPath);
}
