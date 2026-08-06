import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPlaceholderBranch,
  worktreeNameFromPath,
} from '../git/worktree-labels.js';
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
    '- Never push or merge to main/master from here.',
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
  lines.push('Pull requests (when the work is ready to share):');
  lines.push(
    '- Derive the PR title and body from what the changes actually do and why — inspect the diff/commits and the user request. Do not use the soccer-team worktree nickname or placeholder branch as the PR title.',
  );
  lines.push(
    '- Prefer a concise imperative title (Conventional Commits style when it fits: feat:/fix:/chore:/docs:). Body should summarize intent, key changes, and test notes.',
  );
  lines.push(
    '- Commit with messages that state the purpose of the change (same standard as the PR). Stay on this thread branch; never push or merge to main/master from here.',
  );
  if (thread.prUrl) {
    lines.push(
      `- A PR already exists (${thread.prUrl}). Update it (push + edit title/body if the purpose drifted) instead of opening a duplicate.`,
    );
  } else {
    lines.push(
      '- Prefer a draft PR first: `gh pr create --draft` (or update via `gh pr edit`) once the change set is coherent. Mark ready for review only when asked. Title/body must reflect the change purpose, not the worktree name.',
    );
  }
  return lines.join('\n');
}

export interface AgentInstructionFile {
  relativePath: string;
  content: string;
}

/** Relative paths checked per agent (first existing wins per path; all found are included). */
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
  const seen = new Set<string>();
  const out: AgentInstructionFile[] = [];

  for (const rel of candidates) {
    if (seen.has(rel)) continue;
    const abs = join(worktreePath, rel);
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isFile()) continue;
      let content = readFileSync(abs, 'utf8');
      if (!content.trim()) continue;
      if (content.length > MAX_CHARS_PER_FILE) {
        content = `${content.slice(0, MAX_CHARS_PER_FILE)}\n\n…(truncated)`;
      }
      seen.add(rel);
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
