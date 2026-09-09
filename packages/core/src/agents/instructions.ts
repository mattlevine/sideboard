import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatGitAuthModeDirective } from '../git/git-auth-mode.js';
import {
  isPlaceholderBranch,
  ticketSlugForBranch,
  worktreeNameFromPath,
} from '../git/worktree-labels.js';
import { formatDetachedJobInvoke } from '../skills/detached-job-path.js';
import type { GithubGitAuthMode, IssueSource } from '../store/app-settings.js';
import type { Thread } from '../types/thread.js';

function normPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * Conductor-style first-turn instruction: rename the placeholder branch to match
 * the task. Worktree directory stays the nickname (soccer team, plus ticket id
 * when the thread was created from an issue).
 */
export function formatRenameBranchDirective(
  thread: Pick<Thread, 'worktreePath' | 'branchName'> &
    Partial<Pick<Thread, 'sourceType' | 'sourceRef'>>,
  opts?: { customPrompt?: string | null },
): string | null {
  if (!isPlaceholderBranch(thread.branchName, thread.worktreePath)) return null;
  const dir = worktreeNameFromPath(thread.worktreePath);
  const ticket =
    thread.sourceType === 'ticket' ? ticketSlugForBranch(thread.sourceRef ?? '') : null;
  const example = ticket
    ? `\`feat/${ticket}-dark-mode\` or \`fix/${ticket}-panel-width\``
    : '`fix/panel-width` or `feat/dark-mode`';
  const lines = [
    'Branch naming (do this early in the turn):',
    `- Current branch \`${thread.branchName}\` is a temporary placeholder. The worktree folder \`${dir}\` is a stable nickname — do not rename or leave that directory.`,
    `- Rename the git branch to a short kebab-case name that describes this task (what you are changing), e.g. ${example}:`,
    '  `git branch -m <new-name>`',
    '- Prefer Conventional Commits style prefixes when they fit (`fix/`, `feat/`, `chore/`, `docs/`).',
    ...(ticket
      ? [
          `- Keep ticket \`${ticket}\` in the new branch name so the issue stays findable.`,
        ]
      : []),
    '- Never push this placeholder to main/master.',
  ];
  const custom = opts?.customPrompt?.trim();
  if (custom) {
    lines.push(`- Repository naming preference: ${custom}`);
  }
  return lines.join('\n');
}

/**
 * Mandatory Sideboard isolation + landing guidance — agents must edit the thread
 * worktree and open PRs whose titles/bodies describe the *purpose of the changes*.
 */
export function formatWorktreeDirective(
  thread: Pick<Thread, 'worktreePath' | 'repoPath' | 'branchName'> &
    Partial<Pick<Thread, 'title' | 'prUrl'>>,
  opts?: { githubSlug?: string | null; gitAuthMode?: GithubGitAuthMode },
): string {
  const worktree = normPath(thread.worktreePath);
  const repo = normPath(thread.repoPath);
  const dir = worktreeNameFromPath(thread.worktreePath);
  const lines = [
    'Sideboard workspace (mandatory):',
    `- Worktree (your only working directory): ${worktree}`,
    `- Branch: ${thread.branchName}`,
    `- Worktree folder nickname (stable, do not rename): ${dir}`,
  ];
  if (worktree && repo && worktree !== repo) {
    lines.push(`- Main repo checkout (do NOT edit application code here): ${repo}`);
    lines.push(
      'Stay inside the worktree for all Reads, Edits, Writes, installs, tests, and git commands. The main repo is a separate checkout used as the git base/remote — changing files there breaks isolation for this thread and other worktrees.',
    );
  } else {
    lines.push(
      'All file operations and shell commands must use this worktree as cwd. Do not switch to another checkout.',
    );
  }

  lines.push('');
  lines.push('Git remotes + pull requests (when the work is ready to share):');
  lines.push(
    '- Always use this worktree\'s `origin` remote (`git remote get-url origin` from this cwd). Never push to or open PRs against `upstream` (template remotes).',
  );
  lines.push(formatGitAuthModeDirective(opts?.gitAuthMode ?? 'auto'));
  lines.push(
    '- PR title/body and commit messages state what the change does and why (inspect the diff/commits and the user request) — never the worktree nickname or placeholder branch. Concise imperative title (Conventional Commits when it fits: feat:/fix:/chore:/docs:); body = intent, key changes, test notes.',
  );
  lines.push(
    '- Stay on this thread branch. Never push to main/master or merge locally into the main checkout. Merge the PR only when this turn is a Merge PR request or the user explicitly asked — via GitHub from this worktree (`gh pr merge` / `gh stack merge`).',
  );
  if (thread.prUrl) {
    lines.push(
      `- A PR already exists (${thread.prUrl}). Update it (push + edit title/body if the purpose drifted) instead of opening a duplicate.`,
    );
  } else {
    const slug = opts?.githubSlug ?? '<origin-owner/name>';
    const resolve = opts?.githubSlug
      ? ''
      : ' Resolve `<origin-owner/name>` with `git remote get-url origin` in this worktree.';
    lines.push(
      `- Prefer a draft PR first: \`gh pr create --draft -R ${slug}\` (update via \`gh pr edit -R ${slug}\`). Always pass \`-R\` — bare \`gh pr create\` may target upstream on dual-remote checkouts.${resolve} Mark ready for review only when asked. If GitHub rejects the body as too long, retry with a short \`--body-file\` — do not paste a changelog or diff into \`--body\`.`,
    );
  }
  lines.push(
    '- Sideboard git buttons send short phrases ("Commit and push.", "Ready for review.", "Merge PR.", …) with their meaning attached — act on them without asking for clarification. If the user gives a goal (Greptile 5/5, CI green, until checks pass), you get the watch-fix-push playbook with that request.',
  );
  lines.push('');
  lines.push(formatProcessGuideDirective({ worktreePath: thread.worktreePath }));
  return lines.join('\n');
}

/** Short isolation line on every worktree turn (survives CLI resume). */
export function formatWorktreeReminder(): string {
  return 'Sideboard worktree: stay in this cwd for all file and git work. Push and open PRs against origin, never upstream. Do not edit the main repo checkout. If a goal is given (Greptile 5/5, CI green), watch-fix-push until it lands — do not watch after every push.';
}

const PR_GOAL_RE =
  /greptile|\bci\b.*\b(green|pass)|checks?\s+(pass|green)|until\s+.*\b(pass|green|merge|clean)|\bfix ci\b|watch[- ]fix[- ]push/i;

/** True when a request states a PR goal that needs the watch-fix-push playbook. */
export function mentionsPrGoal(prompt: string): boolean {
  return PR_GOAL_RE.test(prompt);
}

const GITHUB_TICKET_REF = /^(?:#?\d+|gh-\d+)$/i;
const KEYED_TICKET_REF =
  /^(?:[A-Z][A-Z0-9]{0,9}-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function issueTicketFromThread(
  thread?: Pick<Thread, 'sourceType' | 'sourceRef'> | null,
  preferredSource: IssueSource = 'github',
): { id: string; provider: IssueSource } | null {
  if (thread?.sourceType !== 'ticket') return null;
  const ref = thread.sourceRef?.trim() ?? '';
  if (!ref) return null;
  if (/github\.com\/[^/]+\/[^/]+\/issues\/\d+/i.test(ref) || GITHUB_TICKET_REF.test(ref)) {
    return { id: ref, provider: 'github' };
  }
  if (KEYED_TICKET_REF.test(ref)) {
    return { id: ref, provider: preferredSource === 'github' ? 'linear' : preferredSource };
  }
  return { id: ref, provider: preferredSource };
}

/** @deprecated Use {@link issueTicketFromThread} */
export function linearTicketIdFromThread(
  thread?: Pick<Thread, 'sourceType' | 'sourceRef'> | null,
): string | null {
  const ticket = issueTicketFromThread(thread, 'linear');
  return ticket?.provider === 'linear' ? ticket.id : null;
}

/**
 * Fresh-session playbook: Account Linear / GitHub / AbleTime via Sideboard MCP.
 * Vendor issue MCPs need a separate login and should be ignored.
 */
export function formatIssueToolsDirective(opts: {
  linear: boolean;
  abletime: boolean;
  github?: boolean;
  ticketId?: string | null;
  ticketProvider?: IssueSource | null;
}): string | null {
  const github = opts.github !== false;
  if (!opts.linear && !opts.abletime && !github) return null;
  const lines = [
    'Issue tracking (Settings → Issues / Git — already signed in):',
    '- Use Sideboard `linear_*` / `github_*` / `abletime_*` tools. Do not call Claude Linear MCP, vendor GitHub MCP, or any other vendor issue MCP — those need a separate login and hang. If a vendor namespace shows needsAuth, ignore it and keep going with Sideboard tools.',
  ];
  if (opts.linear) {
    lines.push(
      '- Linear: `linear_get_issue` (comments; pass `include=full` if crush.truncated), `linear_comment`, `linear_update_issue` (state), `linear_create_issue` (pass `parent` for spin-offs; call `linear_list_teams` first). Scope errors: reconnect Linear in Settings → Issues.',
    );
  }
  if (github) {
    lines.push(
      '- GitHub: `github_get_issue` (comments; pass `include=full` if crush.truncated), `github_comment`, `github_update_issue` (state open|closed), `github_create_issue` (pass `parent` for spin-offs). Uses Account `gh`.',
    );
  }
  if (opts.abletime) {
    lines.push(
      '- AbleTime: `abletime_get_task` (comments; pass `include=full` if crush.truncated), `abletime_comment`, `abletime_update_task` (state), `abletime_create_task` (pass `parent` for spin-offs; `abletime_list_projects` if needed).',
    );
  }
  lines.push(
    '- Do not ask the user to `claude mcp login` for tickets. Reconnect the Account source in Settings → Issues (or Git for `gh`).',
  );
  const ticket = opts.ticketId?.trim();
  if (ticket) {
    const provider = opts.ticketProvider ?? 'linear';
    lines.push(
      `- This thread's ticket is \`${ticket}\` (${provider}). Use that id for get/comment/update; pass it as \`parent\` on spin-offs.`,
    );
  }
  return lines.join('\n');
}

/** @deprecated Use {@link formatIssueToolsDirective} */
export function formatLinearDirective(opts: {
  connected: boolean;
  ticketId?: string | null;
}): string | null {
  return formatIssueToolsDirective({
    linear: opts.connected,
    abletime: false,
    github: false,
    ticketId: opts.ticketId,
    ticketProvider: 'linear',
  });
}

/** Short resume reminder for Account issue tools. */
export function formatIssueToolsReminder(opts: {
  linear: boolean;
  abletime: boolean;
  github?: boolean;
  ticketId?: string | null;
  ticketProvider?: IssueSource | null;
}): string | null {
  const github = opts.github !== false;
  if (!opts.linear && !opts.abletime && !github) return null;
  const names = [
    opts.linear ? 'linear_*' : null,
    github ? 'github_*' : null,
    opts.abletime ? 'abletime_*' : null,
  ].filter(Boolean);
  const ticket = opts.ticketId?.trim();
  const ticketBit = ticket
    ? ` This ticket: ${ticket}${opts.ticketProvider ? ` (${opts.ticketProvider})` : ''} — get/comment/update; create with parent for spin-offs.`
    : ' get/comment/update/create (parent= for spin-offs).';
  return `Issues: Sideboard ${names.join(' / ')} (Account). Ignore vendor issue MCP auth.${ticketBit}`;
}

/** @deprecated Use {@link formatIssueToolsReminder} */
export function formatLinearReminder(opts: {
  connected: boolean;
  ticketId?: string | null;
}): string | null {
  return formatIssueToolsReminder({
    linear: opts.connected,
    abletime: false,
    github: false,
    ticketId: opts.ticketId,
    ticketProvider: 'linear',
  });
}

/**
 * Watch-fix-push loop only when the user gives a goal (not after every push).
 */
export function formatPrGateDirective(): string {
  return [
    'If a goal is given (not after every push):',
    '- Enter a watch-fix-push loop and stay in it until that goal is met or you are blocked (examples: “Greptile 5/5”, “CI green”, “until checks pass”). Do not stop after one red run or one review cycle.',
    '- Wait with `/long-running`: `gh pr checks --watch` (add `-R <origin>` when needed). Present the log. Do not ask the human to poll.',
    '- Greptile 5/5: wait for the greptile check; read the latest `N/5` from the PR body or Greptile’s most recently *updated* issue comment; also fetch unresolved review comments / the “Prompt to fix all with AI” block. Done = **5/5 and zero unresolved Greptile comments**. If Greptile is idle, comment `@greptile review`. Cap about 5 iterations, then report leftovers. Do not merge unless asked.',
  ].join('\n');
}

/**
 * Recurring-process guides: write Claude Code project skills so native CLIs
 * (`attach`, `claude` in the checkout) see them without Sideboard.
 */
export function formatProcessGuideDirective(opts?: { worktreePath?: string | null }): string {
  const worktree = opts?.worktreePath?.trim();
  const hasGraphSkill =
    !!worktree && existsSync(join(worktree, '.claude/skills/graph-engineering/SKILL.md'));
  const hasReviewSkill =
    !!worktree && existsSync(join(worktree, '.claude/skills/review/SKILL.md'));
  const hasInstallSkill =
    !!worktree && existsSync(join(worktree, '.claude/skills/worktree-install/SKILL.md'));
  return [
    'Process guides (recurring work only):',
    hasGraphSkill
      ? '- Migrations, ports, batch fixes, and other fan-out: follow `.claude/skills/graph-engineering/SKILL.md` (`/graph-engineering`). Judge first; state on disk; grow the rulebook; do not patch around it.'
      : null,
    hasInstallSkill
      ? '- After merge-from-main / lockfile change, or a hung `pnpm install`: follow `.claude/skills/worktree-install/SKILL.md` (`/worktree-install`). Use the worktree-local store Sideboard already set; do not share `~/.pnpm-store` across concurrent worktrees.'
      : null,
    '- If this same shape of work will happen again, write `.claude/skills/<kebab-name>/SKILL.md` in this worktree (Claude Code project skill; Sideboard `/name`, Claude Code, and `attach` all load it). Not under `.sideboard/skills/`. Point Codex/OpenCode at it from `AGENTS.md`.',
    hasReviewSkill
      ? '- Merge-readiness notes go in `.claude/skills/review/SKILL.md` (edit it; do not create another review skill).'
      : '- Merge-readiness notes go in `.context/review.md` (copied from `.sideboard/review.md` when that file exists). Do not create a review skill.',
    '- Skip a guide for a one-off. If a matching skill exists, follow it. Same miss twice → edit the skill, do not patch around it.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * How to keep a long shell job alive across Sideboard turn interrupts.
 * Injected on every fresh worktree session; reminder repeats the helper path
 * because CLI `--resume` drops cachedPrefix.
 */
export function formatLongRunningDirective(opts?: { scriptPath?: string | null }): string {
  const invoke = formatDetachedJobInvoke(opts?.scriptPath);
  return [
    'Long-running jobs (mandatory when a command may run more than ~30s — pack, test, deploy, `gh pr checks --watch`):',
    'A Sideboard worktree turn SIGTERMs the agent shell (and its process group) when the user sends another message or the turn is interrupted; `block_until_ms: 0` is not enough. Detach instead, and never ask the human to poll.',
    `- Start once: \`${invoke} start <id> -- <command> [args...]\` (cwd = this worktree; same tool as \`scripts/detached-job.cjs\` when the worktree has it). If JSON says already-running, do not start again.`,
    '- Immediately `present_artifact` `type=log` with `artifact_id=<id>` and `status=running`, then loop Sideboard MCP `wait_for_job` (returns in ~45s). stillRunning → present the same id with `content=delta` only → wait again. Shell fallback: the same helper with `wait <id>`.',
    '- Hanging, no useful output, or the wrong thing → `stop_job` (or the helper with `stop <id>`). Do not stop a pack/test/deploy that is clearly making progress.',
    '- Stay in the loop until stillRunning is false (or you stopped it). ok → finish the task. failed / stopped → read the log, fix or narrow the command, start once.',
    'State: `.context/.sideboard/detached-jobs/<id>/` (local scratch). Full guide: `/long-running` (always available).',
  ].join('\n');
}

/** Short long-job line on every worktree turn (survives CLI resume). */
export function formatLongRunningReminder(opts?: { scriptPath?: string | null }): string {
  const invoke = formatDetachedJobInvoke(opts?.scriptPath);
  return `Long jobs: \`${invoke} start <id> -- <cmd>\`, loop wait_for_job (or detached-job wait), present_artifact type=log (delta). stop_job if hanging or wrong. Do not say you will let the user know later — stay in the turn.`;
}

/**
 * Tell agents how Sideboard renders Claude-style artifacts (side column)
 * and the composer multiple-choice picker (`ask_user`).
 * Claude Code has no claude.ai `artifact` tool — fences / present_artifact instead.
 */
export function formatArtifactDirective(): string {
  // Parameter details live in the Sideboard MCP tool descriptions (always in
  // context) — this block only carries the rules the schemas cannot express.
  return [
    'Sideboard side column (desktop UI) — Sideboard MCP tools present_artifact, present_schema, present_files, ask_user (see their descriptions). claude.ai’s “Artifact” tool does not exist here; never say artifacts, the CMS UI, or the Files column are unavailable.',
    '- Standalone documents: a fenced block tagged `html` (preferred), `svg`, or `markdown` containing the FULL document opens the side column by itself. Use that or present_artifact — never both for the same body.',
    '- present_artifact type=log appends: same artifact_id, content = new lines only (plus status/phase). Do not resend the full log or wrap it in HTML.',
    '- Data: a markdown table is enough to read. Call present_schema only when the user needs to filter/edit/publish/persist rows — including when they ask for an editable table after you already showed markdown. Never re-present rows you already wrote just to display them.',
    '- ask_user only when work is blocked on a few concrete options (approach fork, which API, auth vs cookies): first a short chat message explaining the decision and each option, then the call (description on every option), then stop and wait. Not for greetings, check-ins, or an invented menu of next tasks — reply in chat. If one option is the obvious default, proceed.',
  ].join('\n');
}

/**
 * Short Sideboard UI reminder on every turn (survives CLI resume).
 * Covers the side column and the composer multiple-choice picker.
 */
export function formatUiReminder(): string {
  return 'Sideboard UI: markdown table is enough to read data; present_schema if they ask to edit/filter (even after markdown); present_files for the file manager. html fence or present_artifact, not both for the same document. type=log appends (same artifact_id, new lines only). ask_user only for a real multiple-choice (not hellos or “what next?”) — reply in chat. Do not say artifacts/CMS UI are unavailable.';
}
