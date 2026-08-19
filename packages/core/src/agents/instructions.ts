import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatGitAuthModeDirective } from '../git/git-auth-mode.js';
import {
  isPlaceholderBranch,
  worktreeNameFromPath,
} from '../git/worktree-labels.js';
import type { GithubGitAuthMode } from '../store/app-settings.js';
import type { AgentKind, Thread } from '../types/thread.js';

function normPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * Conductor-style first-turn instruction: rename the placeholder branch to match
 * the task. Worktree directory stays the soccer-team nickname.
 */
export function formatRenameBranchDirective(
  thread: Pick<Thread, 'worktreePath' | 'branchName'>,
  opts?: { customPrompt?: string | null },
): string | null {
  if (!isPlaceholderBranch(thread.branchName, thread.worktreePath)) return null;
  const dir = worktreeNameFromPath(thread.worktreePath);
  const lines = [
    'Branch naming (do this early in the turn):',
    `- Current branch \`${thread.branchName}\` is a temporary placeholder. The worktree folder \`${dir}\` is a stable soccer-team nickname — do not rename or leave that directory.`,
    '- Rename the git branch to a short kebab-case name that describes this task (what you are changing), e.g. `fix/panel-width` or `feat/dark-mode`:',
    '  `git branch -m <new-name>`',
    '- Prefer Conventional Commits style prefixes when they fit (`fix/`, `feat/`, `chore/`, `docs/`).',
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
  lines.push(
    '- Push with `git push -u origin HEAD` (or the current branch name). Do not `git push upstream`.',
  );
  lines.push('');
  lines.push(formatGitAuthModeDirective(opts?.gitAuthMode ?? 'auto'));
  lines.push(
    '- Derive the PR title and body from what the changes actually do and why — inspect the diff/commits and the user request. Do not use the soccer-team worktree nickname or placeholder branch as the PR title.',
  );
  lines.push(
    '- Prefer a concise imperative title (Conventional Commits style when it fits: feat:/fix:/chore:/docs:). Body should summarize intent, key changes, and test notes.',
  );
  lines.push(
    '- Commit with messages that state the purpose of the change (same standard as the PR). Stay on this thread branch. Never push directly to main/master or merge locally into the main checkout. Do not merge the PR unless this turn is a Merge PR request or the user explicitly asked. When merging, use GitHub from this worktree (`gh pr merge` / `gh stack merge`).',
  );
  if (thread.prUrl) {
    lines.push(
      `- A PR already exists (${thread.prUrl}). Update it (push + edit title/body if the purpose drifted) instead of opening a duplicate.`,
    );
  } else if (opts?.githubSlug) {
    lines.push(
      `- Prefer a draft PR first: \`gh pr create --draft -R ${opts.githubSlug}\` (or update via \`gh pr edit -R ${opts.githubSlug}\`) once the change set is coherent. Always pass \`-R ${opts.githubSlug}\` (this worktree's origin). Bare \`gh pr create\` may target upstream instead of origin on dual-remote checkouts. Mark ready for review only when asked. Title/body must reflect the change purpose, not the worktree name.`,
    );
  } else {
    lines.push(
      '- Prefer a draft PR first: `gh pr create --draft -R <origin-owner/name>` (or update via `gh pr edit -R …`) once the change set is coherent. Resolve `<origin-owner/name>` with `git remote get-url origin` in this worktree — never from `upstream`. Mark ready for review only when asked. Title/body must reflect the change purpose, not the worktree name.',
    );
  }
  lines.push('');
  lines.push(
    'Short git requests from the Sideboard UI are complete instructions — expand them using the rules above without asking for clarification:',
  );
  lines.push(
    '- "Commit and push." → commit any uncommitted work with a purpose-stating message, then push to origin (updates an existing PR if one is linked).',
  );
  lines.push(
    '- "Commit, push, and open a draft PR." → commit, push, then create a draft PR with `gh pr create --draft -R …` (title/body from the change purpose).',
  );
  lines.push(
    '- "Commit, push, and open a PR in the browser." → commit, push, then `gh pr create --web -R …`.',
  );
  lines.push(
    '- "Fix CI: <name>." → investigate that failing check, fix it, commit, and push.',
  );
  lines.push(
    '- "Merge the remote branch (<base>) into your branch and resolve conflicts. Then, commit and push your changes." → fetch the PR base, merge it into this branch, resolve conflicts carefully, commit, and push until the PR is mergeable.',
  );
  lines.push(
    '- "Address review comments." → read PR review feedback, make the requested changes, commit, and push.',
  );
  lines.push(
    '- "Merge PR." → merge this thread\'s open pull request on GitHub (this phrase is the explicit ask). If `gh stack view` shows a stack, use `gh stack merge`; otherwise `gh pr merge` (respect repo defaults / squash vs merge). Do not force-push main/master or merge locally into the main checkout.',
  );
  lines.push('');
  lines.push(formatProcessGuideDirective());
  return lines.join('\n');
}

/** Short isolation line on every worktree turn (survives CLI resume). */
export function formatWorktreeReminder(): string {
  return 'Sideboard worktree: stay in this cwd for all file and git work. Push and open PRs against origin, never upstream. Do not edit the main repo checkout.';
}

/**
 * Recurring-process guides: write Claude Code project skills so native CLIs
 * (`attach`, `claude` in the checkout) see them without Sideboard.
 */
export function formatProcessGuideDirective(): string {
  return [
    'Process guides (recurring work only):',
    '- If `.claude/skills/graph-engineering/SKILL.md` exists, follow it (`/graph-engineering`) for migrations, ports, batch fixes, and other fan-out. Judge first; state on disk; grow the rulebook; do not patch around it.',
    '- If this same shape of work will happen again, write `.claude/skills/<kebab-name>/SKILL.md` in this worktree (Claude Code project skill). Sideboard `/name`, Claude Code, and `attach` all load that path. Do not leave the method only in chat.',
    '- Do not write new skills under `.sideboard/skills` — native agents do not scan it. Point Codex/OpenCode at the file from `AGENTS.md`. Optional: symlink `.cursor/skills/<name>` to the Claude skill.',
    '- Skip a guide for a one-off. If a matching skill exists, follow it. Same miss twice → edit the skill (or `.sideboard/review.md`), do not patch around it.',
  ].join('\n');
}

/**
 * Tell agents how Sideboard renders Claude-style artifacts (side column)
 * and the composer multiple-choice picker (`ask_user`).
 * Claude Code has no claude.ai `artifact` tool — fences / present_artifact instead.
 */
export function formatArtifactDirective(): string {
  return [
    'Sideboard side column (desktop UI):',
    'claude.ai’s “Artifact” tool does NOT exist in Claude Code. That is expected.',
    'Documents (HTML/SVG/markdown):',
    '1) Emit a fenced code block tagged `html` (preferred), `svg`, or `markdown` with the FULL document — Sideboard opens a side column. Example:',
    '```html',
    '<!DOCTYPE html><html><head><title>Demo</title></head><body><h1>Hi</h1></body></html>',
    '```',
    '2) Or call Sideboard MCP `present_artifact` with title, type (html|svg|markdown), and content.',
    'CMS / JSON Schema forms & tables (Brightsy or any schema+schemaUi source):',
    '3) Call Sideboard MCP `present_schema` with title, mode (table|form), and either:',
    '   - datasource=brightsy + resource_id (record type UUID) after fetching types via Brightsy MCP, or',
    '   - datasource=inline + resource: { id, title, schema, schemaUi } and optional records/record.',
    'Files / media browser (CMS file manager column):',
    '4) Call Sideboard MCP `present_files` with optional title, path, and datasource (brightsy|memory).',
    '   Opens the Files column for browse/upload/pick. Do NOT say a file manager UI is missing.',
    'Multiple-choice questions:',
    '5) Call Sideboard MCP `ask_user` only when work is blocked on choosing among a few concrete options (approach forks, which API, auth vs cookies). First write a short chat message that explains the decision and what each option means (tradeoffs, when to pick it). Include a description on every option. After calling, stop and wait for their next message with answers. If you are asking a real multiple-choice, use ask_user rather than chat bullets so Sideboard shows the composer picker.',
    'Do not call ask_user for greetings, check-ins, “hello”, open-ended how-can-I-help, or to invent a menu of possible next tasks — reply in chat. If one option is the obvious default, proceed without asking.',
    'Never say artifacts, CMS UI, or the Files column are unavailable. Prefer present_schema for list/edit/publish; present_files for storage UI; html fences for standalone pages; ask_user only for those blocked predefined-option questions.',
  ].join('\n');
}

/**
 * Short Sideboard UI reminder on every turn (survives CLI resume).
 * Covers the side column and the composer multiple-choice picker.
 */
export function formatUiReminder(): string {
  return [
    'Sideboard side column (important):',
    'There is no claude.ai Artifact tool here — that is normal.',
    'HTML/SVG/markdown: ```html fence or MCP present_artifact.',
    'CMS forms/tables: MCP present_schema (Brightsy resource_id or inline schema+schemaUi).',
    'Files column: MCP present_files (brightsy account storage or memory).',
    'Do not say artifacts/CMS UI are unavailable.',
    'ask_user: only when blocked on a real multiple-choice (approach fork, which API). Never for hellos, check-ins, or “what next?” menus — reply in chat.',
  ].join(' ');
}

export interface AgentInstructionFile {
  relativePath: string;
  content: string;
}

/** Relative paths checked per agent (preferred first). Identical bodies are skipped. */
const FILES_BY_AGENT: Record<AgentKind, string[]> = {
  claude: [
    'CLAUDE.md',
    '.claude/CLAUDE.md',
    'CLAUDE.local.md',
    'AGENTS.md',
    'AGENT.md',
  ],
  codex: ['AGENTS.md', 'AGENT.md', '.codex/AGENTS.md', 'CLAUDE.md'],
  opencode: ['AGENTS.md', 'AGENT.md', 'OPENCODE.md', 'CLAUDE.md'],
  brightsy: ['AGENTS.md', 'AGENT.md', 'CLAUDE.md'],
  cursor: ['AGENTS.md', 'AGENT.md', '.cursor/rules', 'CLAUDE.md'],
};

const MAX_CHARS_PER_FILE = 48_000;

/**
 * Load agent instruction files from the worktree (CLAUDE.md, AGENTS.md, …).
 * These are project conventions the CLI may auto-load; we attach them explicitly
 * so non-interactive `-p` / `exec` turns always see them.
 */
export function loadAgentInstructions(
  worktreePath: string,
  agent: AgentKind,
): AgentInstructionFile[] {
  const candidates = FILES_BY_AGENT[agent] ?? FILES_BY_AGENT.claude;
  const seenPaths = new Set<string>();
  const seenBodies = new Set<string>();
  const out: AgentInstructionFile[] = [];

  for (const rel of candidates) {
    if (seenPaths.has(rel)) continue;
    const abs = join(worktreePath, rel);
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isFile()) continue;
      let content = readFileSync(abs, 'utf8');
      if (!content.trim()) continue;
      if (content.length > MAX_CHARS_PER_FILE) {
        content = `${content.slice(0, MAX_CHARS_PER_FILE)}\n\n…(truncated)`;
      }
      const body = content.trim().replace(/\r\n/g, '\n');
      if (seenBodies.has(body)) continue;
      seenPaths.add(rel);
      seenBodies.add(body);
      out.push({ relativePath: rel, content });
    } catch {
      // ignore unreadable
    }
  }

  return out;
}

/** Format instruction files as a stable cacheable prefix (no current request). */
export function formatAgentInstructions(files: AgentInstructionFile[]): string | null {
  if (files.length === 0) return null;
  const parts = [
    'Project agent instructions (from the worktree — follow these):',
    '',
  ];
  for (const f of files) {
    parts.push(`## ${f.relativePath}`);
    parts.push('');
    parts.push(f.content.trim());
    parts.push('');
    parts.push('---');
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

/** Prepend instruction files to the agent-facing prompt. */
export function withAgentInstructions(
  prompt: string,
  files: AgentInstructionFile[],
): string {
  const prefix = formatAgentInstructions(files);
  if (!prefix) return prompt;
  return `${prefix}\n\n${prompt}`;
}
