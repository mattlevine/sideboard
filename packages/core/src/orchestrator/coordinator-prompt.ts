import { resolveGithubRepoSlug } from '../git/worktree.js';
import type { Workspace } from '../store/workspaces.js';

export type WorkspaceInventoryEntry = Workspace & {
  /** Best-effort GitHub `owner/repo` from remote / gh. */
  githubSlug?: string | null;
};

/** Sync formatter — include `githubSlug` when already resolved. */
export function formatWorkspaceInventory(
  workspaces: WorkspaceInventoryEntry[],
): string {
  if (workspaces.length === 0) return '(no registered workspaces)';
  return workspaces
    .map((w) => {
      const slug = w.githubSlug?.trim() ? `  github:${w.githubSlug.trim()}` : '';
      return `- ${w.name}: ${w.path}${slug}`;
    })
    .join('\n');
}

/** Resolve GitHub slugs for registered workspaces (best-effort). */
export async function enrichWorkspacesWithGithub(
  workspaces: Workspace[],
): Promise<WorkspaceInventoryEntry[]> {
  return Promise.all(
    workspaces.map(async (w) => {
      const githubSlug = await resolveGithubRepoSlug(w.path).catch(() => null);
      return { ...w, githubSlug };
    }),
  );
}

const TOOL_PLAYBOOK = [
  'Sideboard MCP tools (use these only — no Edit/Write/Bash on a home checkout):',
  'Discover:',
  '- list_workspaces — registered repos (path + github slug when known)',
  '- list_branches / list_prs / list_issues — pass repoPath from list_workspaces (issues: Linear API or GitHub Issues)',
  '- list_threads / get_thread — fleet status',
  'Workspaces:',
  '- add_workspace / remove_workspace — register or unregister a git repo',
  'Worktree threads (chats):',
  '- create_thread — create a worktree + chat from branch | pr | ticket; pass repoPath + parentThreadId',
  '- send_to_thread — queue a prompt (start/continue a chat turn)',
  '- wait_for_turn / get_turn_result — wait for and read the agent reply',
  '- stop_thread — stop an in-flight agent turn',
  '- archive_thread / restore_thread — archive (tears down worktree when last tab) or restore',
  'Setup / run:',
  '- run_setup — re-run worktree setup',
  '- list_run_scripts / run_dev_script / stop_dev_script — start/stop named run scripts',
  'Inspect / land preview:',
  '- get_diff — compact diff summary',
  '- preview_land — preview push+PR (does NOT confirm)',
  'Human-only (do not attempt): confirm_land, purge_thread.',
].join('\n');

export function coordinatorSystemPrompt(opts: {
  goal: string;
  parentId: string;
  workspaces: WorkspaceInventoryEntry[];
  /** cloud = Brightsy reply framing; desktop = local Global / orchestration chat */
  audience?: 'cloud' | 'desktop';
}): string {
  const audience = opts.audience ?? 'cloud';
  const intro =
    audience === 'cloud'
      ? [
          'You are a Sideboard coordinator responding to a request from a Brightsy cloud agent (Slack, Discord, Teams, or other chat).',
          'Your reply will be sent back to that cloud agent — be concise and actionable.',
        ]
      : [
          'You are a Sideboard global orchestrator coordinating work across registered workspaces.',
          'Stay concise and actionable; prefer Sideboard MCP tools over guessing.',
        ];

  return [
    ...intro,
    'You operate across ALL registered workspaces below.',
    'You have no git home directory — use Sideboard MCP tools only.',
    TOOL_PLAYBOOK,
    'When creating threads, pass the correct repoPath for the target workspace and parentThreadId for children.',
    'Typical flow: list_workspaces → list_branches|list_prs|list_issues → create_thread → send_to_thread → wait_for_turn → (stop_thread | archive_thread as needed).',
    `Goal: ${opts.goal}`,
    `Parent thread id (pass as parentThreadId when creating children): ${opts.parentId}`,
    'Registered workspaces:',
    formatWorkspaceInventory(opts.workspaces),
  ].join('\n');
}
