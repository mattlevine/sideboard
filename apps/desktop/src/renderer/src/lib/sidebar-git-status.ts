export interface SidebarGitStatusInput {
  branchName: string;
  dirty: boolean;
  additions: number;
  deletions: number;
  unpushed: number;
  /** False until the meta pass lands — line counts are not trustworthy yet. */
  ready: boolean;
}

export interface SidebarGitStatusView {
  visible: boolean;
  branch: string;
  additions: number;
  deletions: number;
  unpushed: number;
  dirty: boolean;
  ready: boolean;
  title: string;
}

/** Branch plus uncommitted / unpushed counts for the right-sidebar header. */
export function sidebarGitStatusView(input: SidebarGitStatusInput): SidebarGitStatusView {
  const branch = input.branchName.trim().replace(/^thread\//, '');
  const empty: SidebarGitStatusView = {
    visible: false,
    branch: '',
    additions: 0,
    deletions: 0,
    unpushed: 0,
    dirty: false,
    ready: input.ready,
    title: '',
  };
  if (!branch) return empty;

  const additions = input.ready ? Math.max(0, Math.trunc(input.additions)) : 0;
  const deletions = input.ready ? Math.max(0, Math.trunc(input.deletions)) : 0;
  const unpushed = input.ready ? Math.max(0, Math.trunc(input.unpushed)) : 0;
  const dirty = input.ready && (input.dirty || additions > 0 || deletions > 0);
  const lines = [branch];
  if (!input.ready) lines.push('Loading git status…');
  else if (dirty) lines.push(`Uncommitted +${additions} −${deletions}`);
  else lines.push('Working tree clean');
  if (unpushed > 0) {
    lines.push(`${unpushed} unpushed commit${unpushed === 1 ? '' : 's'}`);
  }
  return {
    visible: true,
    branch,
    additions,
    deletions,
    unpushed,
    dirty,
    ready: input.ready,
    title: lines.join('\n'),
  };
}
