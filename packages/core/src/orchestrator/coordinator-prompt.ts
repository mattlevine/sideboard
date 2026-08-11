import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGithubRepoSlug } from '../git/worktree.js';
import { resolveThreadDefaults } from '../store/app-settings.js';
import { globalAgentCwd, sideboardReposDir } from '../store/paths.js';
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

/** Greenfield repo setup via Bash (outside the synthetic orchestration home). */
export function coordinatorGreenfieldPlaybook(reposDir: string): string {
  return [
    'Greenfield (new app / new GitHub repo) — use Bash + MCP:',
    `- Create or clone under \`${reposDir}/<name>\` (never inside this synthetic home cwd).`,
    '- Examples:',
    `  - Clone: \`git clone <url> ${reposDir}/<name>\``,
    `  - New GitHub repo: \`gh repo create <owner>/<name> --private --clone -- ${reposDir}/<name>\` (or mkdir + git init + gh repo create + remote add + push)`,
    '- Then: add_workspace with that absolute path → create_thread (repoPath + parentThreadId) → send_to_thread (build) → wait_for_turn → send_to_thread (`gh pr create --draft -R <origin-owner/name>`).',
    '- Always target the child worktree\'s **origin** (`github:` slug from list_workspaces / `git remote get-url origin` in that worktree). Never open PRs against `upstream`.',
    '- Do coding work in the child worktree thread, not by editing files in this home cwd.',
  ].join('\n');
}

export const COORDINATOR_TOOL_PLAYBOOK = [
  'Role: you oversee Sideboard worktree agents across registered repos. You do not live inside one of those worktrees.',
  'Sideboard MCP (fleet control — prefer these for status and orchestration):',
  'Discover:',
  '- list_workspaces — registered repos (path + github slug when known)',
  '- list_branches / list_prs / list_issues — pass repoPath from list_workspaces (issues: Linear API or GitHub Issues)',
  '- get_pr_stack / open_pr_stack_layers / add_stack_layer / create_pr_stack — GitHub stacked PRs (`gh stack`); one worktree per layer',
  '- list_models — only when you need a specific model (rare); otherwise omit model so Account defaults apply',
  '- list_threads / get_thread — fleet status (what is going on)',
  'Workspaces:',
  '- add_workspace / remove_workspace — register or unregister a git repo',
  'Worktree threads (chats):',
  '- create_thread — create a worktree + chat from branch | pr | ticket; pass repoPath + parentThreadId; omit agent and model to use Sideboard Account defaults (Settings → Default agent, model & effort)',
  '- fork_worktree — fork a worktree chat into a NEW git worktree + chat (transcript attached); optional agent; leave model unset (Auto) unless you have a reason. Not for orchestration chats.',
  '- fork_chat — fork a worktree chat (same worktree tab) OR a Global orchestration chat (new orchestration tab); optional agent; leave model unset (Auto) unless you have a reason. Remote coordinators: use this to continue another orchestration chat on a different agent after session limits.',
  '- send_to_thread — queue a prompt (start/continue a chat turn); pass force_stop: true to interrupt mid-turn / clear stale queued prompts before replacing with a new request',
  '- wait_for_turn / get_turn_result — wait for and read the agent reply',
  '- stop_thread — force-stop: kill in-flight turn AND clear queued prompts (do not leave stale queue after an interrupt)',
  '- archive_thread / restore_thread — archive (tears down worktree when last tab) or restore',
  'Setup / run:',
  '- run_setup — re-run worktree setup',
  '- list_run_scripts / run_dev_script / stop_dev_script — start/stop named run scripts',
  'Inspect / review / PRs:',
  '- get_diff — compact diff summary',
  '- request_review — open a Review chat tab on a worktree thread (attaches .sideboard/review.md when present, else local guidelines; sends "Review."); then wait_for_turn / get_turn_result on the returned id',
  '- Ask the worktree agent via send_to_thread to open a draft PR with `gh pr create --draft -R <origin-owner/name>` (workspace `github:` slug / that worktree\'s origin — never upstream). Do not open PRs from the orchestrator yourself.',
  'Human-only (do not attempt): merge, ready-for-review land, purge_thread.',
  'Thread links in replies: when mentioning a chat/thread for the user, include a markdown link `[Title](sideboard://thread/<id>)` using the full id (or the link field from create_thread / list_threads). Sideboard renders these as clickable opens.',
  'Bash / Read / etc: allowed for (1) inspecting target worktrees / registered repo paths from MCP, and (2) greenfield setup under ~/sideboard/repos (git clone, gh repo create, git init+remote). Never git init/clone *inside* this synthetic home cwd — emptiness here is expected, not a bug.',
].join('\n');

function accountDefaultsPlaybookLine(): string {
  const d = resolveThreadDefaults();
  const model = d.model?.trim() || 'Auto';
  return `- Account defaults for create_thread (omit agent/model to use these): agent=${d.agent}, model=${model}, effort=${d.effort}`;
}

/**
 * Short identity block prepended to every orchestration turn prompt.
 * Survives Claude `--resume` (which drops cachedPrefix).
 */
export function coordinatorTurnReminder(opts: {
  parentId: string;
  goal?: string;
}): string {
  const goal = opts.goal?.trim();
  return [
    'Sideboard Orchestration (mandatory):',
    '- You oversee Sideboard worktree agents. You are not yourself checked out in a project worktree.',
    '- This cwd is a synthetic empty home (not a git repo). Emptiness here is expected — it is not a problem to fix.',
    '- Registered workspaces / child threads are the fleet you manage via Sideboard MCP.',
    `- Parent thread id (pass as parentThreadId when creating children): ${opts.parentId}`,
    goal ? `- Goal / title: ${goal}` : null,
    accountDefaultsPlaybookLine(),
    '- For "what\'s going on": call list_threads (and list_workspaces if needed). Summarize fleet status — do not ls/git-status this synthetic home.',
    '- Existing repo: create_thread on a repoPath → send_to_thread → wait_for_turn.',
    '- New repo: Bash (clone or gh repo create under ~/sideboard/repos/<name>) → add_workspace → create_thread → send_to_thread → wait_for_turn → draft PR.',
    '- When naming threads for the user, link them as `[Title](sideboard://thread/<id>)`.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Write durable CLAUDE.md / AGENTS.md into the global synthetic cwd so Claude
 * (and other agents that load AGENTS.md) keep orchestrator identity on resume.
 */
export function ensureGlobalCoordinatorCwd(): string {
  const dir = globalAgentCwd();
  mkdirSync(dir, { recursive: true });
  const reposDir = sideboardReposDir();
  const body = [
    '# Sideboard Orchestration',
    '',
    'You are the Sideboard **Orchestration** agent — you oversee worktree agents in the Sideboard app.',
    'You are **not** connected to a single project workspace. This directory is a synthetic empty cwd (not a git worktree).',
    'It being empty / not a git repo is **normal**. Do not initialize git here or ask the user to point you at a repo for *your* checkout.',
    'Repos from `list_workspaces` and threads from `list_threads` are the fleet you orchestrate.',
    'For status questions ("what\'s going on?"), use `list_threads` / `list_workspaces` — never diagnose this synthetic home as a broken worktree.',
    'Bash is fine for inspecting **child worktree** / registered-repo paths, and for greenfield repo setup under the Sideboard repos directory — not for treating this home as the project.',
    '',
    COORDINATOR_TOOL_PLAYBOOK,
    '',
    accountDefaultsPlaybookLine(),
    '',
    coordinatorGreenfieldPlaybook(reposDir),
    '',
    'When creating threads, pass `repoPath` from `list_workspaces` (or the path you just registered) and `parentThreadId` for children.',
    'Omit `agent` / `model` on `create_thread` unless you have a reason to override Account defaults.',
    'Typical flow (existing): list_workspaces → list_branches|list_prs|list_issues → create_thread → send_to_thread → wait_for_turn.',
    'Typical flow (new app): Bash create/clone under repos dir → add_workspace → create_thread → send_to_thread (implement) → wait_for_turn → draft PR via worktree agent.',
    'Always ask worktree agents to open draft PRs (`send_to_thread` + `gh pr create --draft -R <origin>`); never open PRs from the orchestrator.',
  ].join('\n');
  // Always rewrite so tool playbook updates ship without manual cleanup.
  writeFileSync(join(dir, 'CLAUDE.md'), `${body}\n`, 'utf8');
  writeFileSync(join(dir, 'AGENTS.md'), `${body}\n`, 'utf8');
  return dir;
}

export function coordinatorSystemPrompt(opts: {
  goal: string;
  parentId: string;
  workspaces: WorkspaceInventoryEntry[];
  /** cloud = Brightsy reply framing; desktop = local Orchestration chat */
  audience?: 'cloud' | 'desktop';
}): string {
  const audience = opts.audience ?? 'cloud';
  const reposDir = sideboardReposDir();
  const intro =
    audience === 'cloud'
      ? [
          'You are a Sideboard coordinator responding to a request from a Brightsy cloud agent (Slack, Discord, Teams, or other chat).',
          'Your reply will be sent back to that cloud agent — be concise and actionable.',
        ]
      : [
          'You are a Sideboard orchestration agent: you oversee worktree agents across registered workspaces in the Sideboard app.',
          'Stay concise and actionable; prefer Sideboard MCP for fleet status; use Bash for greenfield repo setup and inspecting target worktree paths.',
        ];

  return [
    ...intro,
    'You operate across ALL registered workspaces below.',
    'You have no project git home — this process cwd is synthetic and empty on purpose.',
    COORDINATOR_TOOL_PLAYBOOK,
    accountDefaultsPlaybookLine(),
    coordinatorGreenfieldPlaybook(reposDir),
    'When creating threads, pass the correct repoPath for the target workspace and parentThreadId for children.',
    'Omit agent/model on create_thread unless you need to override Account defaults.',
    'Typical flow (existing): list_workspaces → list_branches|list_prs|list_issues → create_thread → send_to_thread (implement) → wait_for_turn → send_to_thread (ask for `gh pr create --draft -R <origin-owner/name>` using the workspace github slug) → wait_for_turn. Never target upstream. Never open PRs from the orchestrator.',
    'Typical flow (new app): Bash under repos dir (clone or gh repo create) → add_workspace → create_thread → send_to_thread → wait_for_turn → draft PR via worktree agent.',
    `Goal: ${opts.goal}`,
    `Parent thread id (pass as parentThreadId when creating children): ${opts.parentId}`,
    'Registered workspaces:',
    formatWorkspaceInventory(opts.workspaces),
  ].join('\n');
}
