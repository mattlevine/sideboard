import { GLOBAL_WORKSPACE_ID } from './global-workspace';

export function repoBasename(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

export type WorkspaceChromeLabels = {
  project: string;
  /** PR title when linked, otherwise the git branch name. */
  task: string | null;
};

function isOrchestrationChrome(thread: {
  repoPath: string;
  sourceType?: string;
}): boolean {
  return thread.sourceType === 'orchestration' || thread.repoPath === GLOBAL_WORKSPACE_ID;
}

/** Conductor-style titlebar: `project > PR title` (or branch if no PR). */
export function workspaceChromeLabels(thread: {
  repoPath: string;
  worktreePath: string;
  title?: string | null;
  sourceType?: string;
  branchName?: string;
  prTitle?: string | null;
}): WorkspaceChromeLabels {
  if (isOrchestrationChrome(thread)) {
    const title = thread.title?.trim() || 'Untitled';
    return { project: 'Orchestration', task: title };
  }
  const project = repoBasename(thread.repoPath);
  const pr = thread.prTitle?.trim();
  if (pr) return { project, task: pr };
  const branch = (thread.branchName ?? '').trim();
  if (!branch || branch === 'HEAD') return { project, task: null };
  return { project, task: branch };
}
