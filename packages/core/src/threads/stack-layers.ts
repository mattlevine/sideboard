/**
 * Materialize one git worktree + Sideboard thread per GitHub stack layer.
 */

import { existsSync } from 'node:fs';
import { requireAgent } from '../detect/detect.js';
import { git } from '../git/run.js';
import {
  addPrStackLayer,
  getPrStack,
  initPrStack,
  type GhStackStatus,
  detectGhStack,
} from '../git/stack.js';
import {
  allocateTeamSlug,
  createExistingBranchWorktree,
  createThreadWorktree,
  listWorktrees,
  removeWorktree,
  resolveDefaultBranch,
  resolveRepoRoot,
} from '../git/worktree.js';
import { copyConfiguredFiles } from '../hook/conductor.js';
import {
  createEmptyThread,
  findThreadByRef,
  listThreads,
  readThread,
  updateThread,
  writeThread,
} from '../store/thread-store.js';
import { ensureWorkspace } from '../store/workspaces.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';
import type {
  AgentKind,
  Autonomy,
  CreateThreadInput,
  PrStack,
  PrStackLayer,
  Thread,
} from '../types/thread.js';

export function stackIdFrom(stack: PrStack): string | null {
  if (stack.stackNumber != null) return `gh-stack-${stack.stackNumber}`;
  // Stable fallback when GitHub has not assigned a stack number yet.
  const key = stack.layers.map((l) => l.branchName).join('|');
  if (!key) return null;
  return `gh-stack-local-${hashShort(key)}`;
}

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function requireThread(idOrRef: string): Thread {
  const thread = findThreadByRef(idOrRef) ?? readThread(idOrRef);
  if (!thread) throw new Error(`Thread not found: ${idOrRef}`);
  return thread;
}

function sanitizeSlugPart(name: string): string {
  return name
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'layer';
}

function layerSlug(stackId: string, layer: PrStackLayer): string {
  const stackPart = stackId.replace(/^gh-stack-/, 's');
  return sanitizeSlugPart(`${stackPart}-L${layer.position}-${layer.branchName}`);
}

export function findThreadForStackLayer(
  repoPath: string,
  stackId: string,
  layer: Pick<PrStackLayer, 'position' | 'branchName'>,
): Thread | null {
  const threads = listThreads({ includeArchived: false }).filter(
    (t) => t.repoPath === repoPath && t.stackId === stackId,
  );
  const byLayer = threads.find((t) => t.stackLayer === layer.position);
  if (byLayer) return byLayer;
  return (
    threads.find((t) => t.branchName === layer.branchName) ??
    listThreads({ includeArchived: false }).find(
      (t) => t.repoPath === repoPath && t.branchName === layer.branchName,
    ) ??
    null
  );
}

export type OpenStackLayerInput = {
  repoPath: string;
  stack: PrStack;
  layer: PrStackLayer;
  agent: AgentKind;
  autonomy?: Autonomy;
  model?: string | null;
  effort?: ThinkingEffort;
  fast?: boolean;
  planMode?: boolean;
  parentThreadId?: string | null;
  /** Prefer this existing worktree when the branch is already checked out. */
  reuseExistingWorktree?: boolean;
};

export type OpenStackLayerResult = {
  thread: Thread;
  /** True when a new git worktree was created (caller should run setup). */
  createdWorktree: boolean;
};

/** Open (or return) a thread for one stack layer worktree. */
export async function openStackLayer(
  input: OpenStackLayerInput,
  _onSetupLine?: (line: string) => void,
): Promise<OpenStackLayerResult> {
  await requireAgent(input.agent);
  const repoPath = await resolveRepoRoot(input.repoPath);
  const stackId = stackIdFrom(input.stack);
  if (!stackId) throw new Error('Cannot open stack layer without a stack id');

  const existing = findThreadForStackLayer(repoPath, stackId, input.layer);
  if (existing) {
    const patch: Partial<Thread> = {};
    if (existing.stackId !== stackId) patch.stackId = stackId;
    if (existing.stackLayer !== input.layer.position) {
      patch.stackLayer = input.layer.position;
    }
    if (input.layer.prUrl && existing.prUrl !== input.layer.prUrl) {
      patch.prUrl = input.layer.prUrl;
    }
    if (input.layer.title && existing.prTitle !== input.layer.title) {
      patch.prTitle = input.layer.title;
    }
    if (Object.keys(patch).length > 0) updateThread(existing.id, patch);
    return {
      thread: readThread(existing.id) ?? existing,
      createdWorktree: false,
    };
  }

  let worktreePath: string | null = null;
  let branchName = input.layer.branchName;
  let createdWorktree = false;

  const trees = await listWorktrees(repoPath);
  const checkedOut = trees.find((w) => w.branch === branchName);
  if (checkedOut?.path && existsSync(checkedOut.path)) {
    if (input.reuseExistingWorktree !== false) {
      worktreePath = checkedOut.path;
    } else {
      throw new Error(
        `Branch ${branchName} is already checked out at ${checkedOut.path}`,
      );
    }
  }

  if (!worktreePath) {
    const slug = layerSlug(stackId, input.layer);
    const created = await createExistingBranchWorktree({
      repoPath,
      branchName,
      slug,
    });
    worktreePath = created.worktreePath;
    branchName = created.branchName;
    copyConfiguredFiles(repoPath, worktreePath);
    createdWorktree = true;
  }

  const title =
    input.layer.title?.trim() ||
    (input.layer.prNumber != null
      ? `PR #${input.layer.prNumber}`
      : input.layer.branchName);

  const thread = createEmptyThread({
    title,
    userSetTitle: Boolean(input.layer.title?.trim()),
    sourceType: input.layer.prNumber != null ? 'pr' : 'branch',
    sourceRef:
      input.layer.prNumber != null
        ? String(input.layer.prNumber)
        : input.layer.branchName,
    branchName,
    worktreePath,
    repoPath,
    agent: input.agent,
    autonomy: input.autonomy ?? 'default',
    model: input.model ?? null,
    effort: input.effort ?? 'high',
    fast: Boolean(input.fast),
    planMode: Boolean(input.planMode),
    parentThreadId: input.parentThreadId ?? null,
    status: 'idle',
    prUrl: input.layer.prUrl,
    prTitle: input.layer.title ?? null,
    stackId,
    stackLayer: input.layer.position,
  });
  writeThread(thread);
  await ensureWorkspace(repoPath);

  // Setup is run by the orchestrator when createdWorktree is true.
  return { thread: readThread(thread.id) ?? thread, createdWorktree };
}

export type OpenPrStackLayersInput = {
  /** Any thread already on a stack layer (used for agent defaults + discovery). */
  threadRef: string;
  /** When set, only open this 1-based layer; otherwise open all. */
  layer?: number;
};

/** Open worktrees/threads for stack layers discovered from a thread's cwd. */
export async function openPrStackLayers(
  input: OpenPrStackLayersInput,
  onSetupLine?: (line: string) => void,
): Promise<{ stack: PrStack; threads: Thread[]; createdThreadIds: string[] }> {
  const from = requireThread(input.threadRef);
  if (!from.worktreePath?.trim() || !from.repoPath?.trim()) {
    throw new Error('Thread has no worktree');
  }
  const stack = await getPrStack(from.worktreePath);
  if (!stack) throw new Error('Current branch is not part of a GitHub PR stack');

  const layers =
    input.layer != null
      ? stack.layers.filter((l) => l.position === input.layer)
      : stack.layers;
  if (!layers.length) {
    throw new Error(
      input.layer != null
        ? `No stack layer at position ${input.layer}`
        : 'Stack has no layers',
    );
  }

  const threads: Thread[] = [];
  const createdThreadIds: string[] = [];
  for (const layer of layers) {
    const { thread, createdWorktree } = await openStackLayer(
      {
        repoPath: from.repoPath,
        stack,
        layer,
        agent: from.agent,
        autonomy: from.autonomy,
        model: from.model,
        effort: from.effort,
        fast: from.fast,
        planMode: from.planMode,
        parentThreadId: from.id,
      },
      onSetupLine,
    );
    threads.push(thread);
    if (createdWorktree) createdThreadIds.push(thread.id);
  }

  // Keep the source thread linked too.
  const stackId = stackIdFrom(stack);
  const current = stack.layers[stack.currentIndex];
  if (stackId) {
    updateThread(from.id, {
      stackId,
      stackLayer: current?.position ?? from.stackLayer,
    });
  }

  return { stack, threads, createdThreadIds };
}

export type AddStackLayerInput = {
  threadRef: string;
  branchName: string;
  title?: string;
};

/** `gh stack add` then open a worktree+thread for the new top layer. */
export async function addStackLayerFromThread(
  input: AddStackLayerInput,
  onSetupLine?: (line: string) => void,
): Promise<{ stack: PrStack; thread: Thread; createdWorktree: boolean }> {
  const from = requireThread(input.threadRef);
  if (!from.worktreePath?.trim() || !from.repoPath?.trim()) {
    throw new Error('Thread has no worktree');
  }
  const status: GhStackStatus = await detectGhStack(from.worktreePath);
  if (!status.available) throw new Error(status.reason);

  await addPrStackLayer(from.worktreePath, input.branchName);
  const stack = await getPrStack(from.worktreePath);
  if (!stack) throw new Error('Stack not found after adding layer');

  const layer =
    stack.layers.find((l) => l.branchName === input.branchName.trim()) ??
    stack.layers[stack.layers.length - 1];
  if (!layer) throw new Error('New stack layer not found');

  if (input.title?.trim()) {
    layer.title = input.title.trim();
  }

  const thread = await openStackLayer(
    {
      repoPath: from.repoPath,
      stack,
      layer,
      agent: from.agent,
      autonomy: from.autonomy,
      model: from.model,
      effort: from.effort,
      fast: from.fast,
      planMode: from.planMode,
      parentThreadId: from.id,
    },
    onSetupLine,
  );

  return { stack, thread: thread.thread, createdWorktree: thread.createdWorktree };
}

export type InitStackFromThreadInput = {
  threadRef: string;
  /** Extra layers above the current branch (created empty on top). */
  additionalBranches?: string[];
  base?: string;
};

/**
 * Initialize a stack from the current thread's branch (bottom),
 * optionally adding further empty layers, then open worktrees for each.
 */
export async function initStackFromThread(
  input: InitStackFromThreadInput,
  onSetupLine?: (line: string) => void,
): Promise<{ stack: PrStack; threads: Thread[]; createdThreadIds: string[] }> {
  const from = requireThread(input.threadRef);
  if (!from.worktreePath?.trim() || !from.branchName?.trim() || !from.repoPath?.trim()) {
    throw new Error('Thread has no worktree/branch');
  }
  const status = await detectGhStack(from.worktreePath);
  if (!status.available) throw new Error(status.reason);

  const branches = [
    from.branchName,
    ...(input.additionalBranches ?? []).map((b) => b.trim()).filter(Boolean),
  ];
  await initPrStack(from.worktreePath, branches, {
    base: input.base ?? (await resolveDefaultBranch(from.repoPath)),
  });

  return openPrStackLayers({ threadRef: from.id }, onSetupLine);
}

export type CreateStackInput = {
  repoPath: string;
  /** Bottom → top branch names (created or adopted by gh stack init). */
  branches: string[];
  base?: string;
  agent: AgentKind;
  autonomy?: Autonomy;
  model?: string | null;
  effort?: ThinkingEffort;
  fast?: boolean;
  planMode?: boolean;
  title?: string;
};

/**
 * Create a new stack from trunk: init branches, then one worktree+thread per layer.
 * First layer gets an optional title; others use branch names until PRs exist.
 */
export async function createPrStack(
  input: CreateStackInput,
  onSetupLine?: (line: string) => void,
): Promise<{ stack: PrStack; threads: Thread[]; createdThreadIds: string[] }> {
  await requireAgent(input.agent);
  const repoPath = await resolveRepoRoot(input.repoPath);
  if (!existsSync(repoPath)) throw new Error(`Repo not found: ${repoPath}`);
  if (!input.branches.length) throw new Error('At least one branch name required');

  const status = await detectGhStack(repoPath);
  if (!status.available) throw new Error(status.reason);

  // Bootstrap from a temporary worktree on trunk so `gh stack init` has a cwd.
  const team = allocateTeamSlug(repoPath);
  const base = input.base ?? (await resolveDefaultBranch(repoPath));
  const bootstrap = await createThreadWorktree({
    repoPath,
    sourceRef: base,
    slug: `${team.slug}-stack-init`,
  });
  copyConfiguredFiles(repoPath, bootstrap.worktreePath);

  try {
    await initPrStack(bootstrap.worktreePath, input.branches, { base });
    // `gh stack view` requires being on a stack branch.
    const bottom = input.branches[0]!;
    const co = await git(['checkout', bottom], bootstrap.worktreePath, {
      reject: false,
    });
    if (co.exitCode !== 0) {
      throw new Error(
        co.stderr.trim() ||
          co.stdout.trim() ||
          `Could not check out ${bottom} after stack init`,
      );
    }
  } catch (err) {
    try {
      await removeWorktree(repoPath, bootstrap.worktreePath, {
        deleteBranch: bootstrap.branchName,
      });
    } catch {
      // ignore
    }
    throw err;
  }

  const stack = await getPrStack(bootstrap.worktreePath);
  if (!stack) {
    try {
      await removeWorktree(repoPath, bootstrap.worktreePath, {
        deleteBranch: bootstrap.branchName,
      });
    } catch {
      // ignore
    }
    throw new Error('Stack init succeeded but gh stack view returned no stack');
  }

  const threads: Thread[] = [];
  const createdThreadIds: string[] = [];
  for (const layer of stack.layers) {
    const title =
      layer.position === 1 && input.title?.trim()
        ? input.title.trim()
        : layer.title;
    // Bottom layer may already be checked out in the bootstrap worktree — reuse it.
    const opened = await openStackLayer(
      {
        repoPath,
        stack,
        layer: title ? { ...layer, title } : layer,
        agent: input.agent,
        autonomy: input.autonomy,
        model: input.model,
        effort: input.effort,
        fast: input.fast,
        planMode: input.planMode,
        reuseExistingWorktree: true,
      },
      onSetupLine,
    );
    threads.push(opened.thread);
    // Reused bootstrap checkout still needs setup (fresh worktree files).
    if (opened.createdWorktree || opened.thread.worktreePath === bootstrap.worktreePath) {
      createdThreadIds.push(opened.thread.id);
    }
  }

  // If bootstrap path was not claimed as a layer thread, remove it.
  const claimed = new Set(threads.map((t) => t.worktreePath));
  if (!claimed.has(bootstrap.worktreePath) && existsSync(bootstrap.worktreePath)) {
    try {
      await removeWorktree(repoPath, bootstrap.worktreePath, {
        deleteBranch: bootstrap.branchName,
      });
    } catch {
      // ignore
    }
  }

  return { stack, threads, createdThreadIds };
}

/** Defaults for opening stack layers from CreateThreadInput-shaped callers. */
export function stackAgentDefaultsFrom(
  input: Pick<
    CreateThreadInput,
    'agent' | 'autonomy' | 'model' | 'effort' | 'fast' | 'planMode'
  >,
): Pick<
  OpenStackLayerInput,
  'agent' | 'autonomy' | 'model' | 'effort' | 'fast' | 'planMode'
> {
  return {
    agent: input.agent,
    autonomy: input.autonomy,
    model: input.model,
    effort: input.effort,
    fast: input.fast,
    planMode: input.planMode,
  };
}
