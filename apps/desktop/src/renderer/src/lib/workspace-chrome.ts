import { branchDisplayLabel } from '@sideboard/worktree-labels';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';
import { nestedChatDisplayTitle } from './nested-chat-title';

export function repoBasename(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

export type WorkspaceChromeLabels = {
  project: string;
  /** PR title when linked, otherwise the git branch (or soccer nickname). */
  task: string | null;
  /** Purpose name of the current agent — not the worktree/PR title. */
  agent: string | null;
};

export type WorkspaceChromeCrumb = {
  kind: 'project' | 'task' | 'agent';
  label: string;
};

function isOrchestrationChrome(thread: {
  repoPath: string;
  sourceType?: string;
}): boolean {
  return thread.sourceType === 'orchestration' || thread.repoPath === GLOBAL_WORKSPACE_ID;
}

/**
 * Titlebar: `project > PR/branch > agent` for git worktrees.
 * Orchestration has no worktree, so it is only `Orchestration > agent`.
 */
export function workspaceChromeLabels(thread: {
  repoPath: string;
  worktreePath: string;
  title?: string | null;
  userSetTitle?: boolean;
  sourceType?: string;
  branchName?: string;
  prTitle?: string | null;
}): WorkspaceChromeLabels {
  if (isOrchestrationChrome(thread)) {
    return {
      project: 'Orchestration',
      task: null,
      agent: nestedChatDisplayTitle(thread, 'Orchestration'),
    };
  }
  const project = repoBasename(thread.repoPath);
  const pr = thread.prTitle?.trim();
  const branch = branchDisplayLabel(thread.branchName ?? '', thread.worktreePath);
  const task = pr || branch || null;
  const agent = nestedChatDisplayTitle(thread, task || project);
  return { project, task, agent };
}

/** Ordered unique crumbs so a missing worktree is not filled with a duplicate project name. */
export function workspaceChromeCrumbs(
  labels: WorkspaceChromeLabels,
): WorkspaceChromeCrumb[] {
  const out: WorkspaceChromeCrumb[] = [];
  const push = (kind: WorkspaceChromeCrumb['kind'], label: string | null) => {
    const trimmed = label?.trim() ?? '';
    if (!trimmed) return;
    if (out.some((c) => c.label === trimmed)) return;
    out.push({ kind, label: trimmed });
  };
  push('project', labels.project);
  push('task', labels.task);
  push('agent', labels.agent);
  return out;
}
