import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

export interface RepoSettings {
  /** Which file was loaded */
  source: 'sideboard' | 'conductor';
  setup?: string;
  filesToCopy?: string[];
  runScripts: Array<{ name: string; command: string; default?: boolean }>;
  /** Optional override for worktree root (supports ~) */
  worktreesRoot?: string;
  editor?: string;
  /** Conductor-compatible agent prompt overrides from `[prompts]`. */
  prompts?: {
    renameBranch?: string;
    createPr?: string;
    general?: string;
  };
}

function expandHome(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function parseSettingsFile(
  path: string,
  source: 'sideboard' | 'conductor',
): RepoSettings | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const data = parseToml(raw) as Record<string, unknown>;

  const scripts = (data.scripts ?? {}) as Record<string, unknown>;
  const setup = typeof scripts.setup === 'string' ? scripts.setup : undefined;

  const filesToCopy: string[] = [];
  const files = data.files as { copy?: string[] } | undefined;
  if (Array.isArray(files?.copy)) {
    filesToCopy.push(...files.copy.map(String));
  }
  const copySection = data['files-to-copy'] as { paths?: string[] } | undefined;
  if (Array.isArray(copySection?.paths)) {
    filesToCopy.push(...copySection.paths.map(String));
  }

  const runScripts: RepoSettings['runScripts'] = [];
  const run = scripts.run as Record<string, { command?: string; default?: boolean }> | undefined;
  if (run && typeof run === 'object') {
    for (const [name, value] of Object.entries(run)) {
      if (value && typeof value.command === 'string') {
        runScripts.push({
          name,
          command: value.command,
          default: Boolean(value.default),
        });
      }
    }
  }

  const worktrees = data.worktrees as { root?: string } | undefined;
  const worktreesRoot =
    typeof worktrees?.root === 'string' ? expandHome(worktrees.root) : undefined;

  const editor =
    typeof (data as { editor?: string }).editor === 'string'
      ? String((data as { editor: string }).editor)
      : undefined;

  const promptsRaw = (data.prompts ?? {}) as Record<string, unknown>;
  const prompts = {
    renameBranch:
      typeof promptsRaw.rename_branch === 'string'
        ? promptsRaw.rename_branch
        : undefined,
    createPr:
      typeof promptsRaw.create_pr === 'string' ? promptsRaw.create_pr : undefined,
    general: typeof promptsRaw.general === 'string' ? promptsRaw.general : undefined,
  };
  const hasPrompts = Boolean(prompts.renameBranch || prompts.createPr || prompts.general);

  return {
    source,
    setup,
    filesToCopy,
    runScripts,
    worktreesRoot,
    editor,
    prompts: hasPrompts ? prompts : undefined,
  };
}

function normPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * Prefer `.sideboard/settings.toml`, fall back to `.conductor/settings.toml`.
 * Same schema shape for scripts / files-to-copy / run blocks.
 */
export function loadRepoSettings(repoPath: string): RepoSettings | null {
  const sideboard = parseSettingsFile(
    join(repoPath, '.sideboard', 'settings.toml'),
    'sideboard',
  );
  if (sideboard) return sideboard;

  return parseSettingsFile(join(repoPath, '.conductor', 'settings.toml'), 'conductor');
}

/**
 * Load settings for a Sideboard thread: prefer the worktree (where the agent
 * edits), then fall back to the main repo checkout.
 */
export function loadWorkspaceSettings(
  worktreePath: string,
  repoPath?: string | null,
): RepoSettings | null {
  const fromWorktree = loadRepoSettings(worktreePath);
  if (fromWorktree) return fromWorktree;
  if (
    repoPath &&
    normPath(repoPath) &&
    normPath(repoPath) !== normPath(worktreePath)
  ) {
    return loadRepoSettings(repoPath);
  }
  return null;
}

/** @deprecated use loadRepoSettings */
export function loadConductorSettings(repoPath: string): RepoSettings | null {
  return loadRepoSettings(repoPath);
}

export function hasRepoHook(repoPath: string): boolean {
  return (
    existsSync(join(repoPath, '.sideboard', 'settings.toml')) ||
    existsSync(join(repoPath, '.conductor', 'settings.toml'))
  );
}

/** True if either the worktree or (optional) main repo has setup/run config. */
export function hasWorkspaceHook(
  worktreePath: string,
  repoPath?: string | null,
): boolean {
  if (hasRepoHook(worktreePath)) return true;
  if (
    repoPath &&
    normPath(repoPath) !== normPath(worktreePath) &&
    hasRepoHook(repoPath)
  ) {
    return true;
  }
  return false;
}

/** @deprecated use hasRepoHook / hasWorkspaceHook */
export function hasConductorHook(
  worktreePath: string,
  repoPath?: string | null,
): boolean {
  return hasWorkspaceHook(worktreePath, repoPath);
}

export function settingsSourceLabel(rootPath: string): string | null {
  if (existsSync(join(rootPath, '.sideboard', 'settings.toml'))) {
    return '.sideboard/settings.toml';
  }
  if (existsSync(join(rootPath, '.conductor', 'settings.toml'))) {
    return '.conductor/settings.toml';
  }
  return null;
}

/** Label including whether config was found in the worktree vs main repo. */
export function workspaceSettingsSourceLabel(
  worktreePath: string,
  repoPath?: string | null,
): string | null {
  const wt = settingsSourceLabel(worktreePath);
  if (wt) return `${wt} (worktree)`;
  if (
    repoPath &&
    normPath(repoPath) !== normPath(worktreePath)
  ) {
    const repo = settingsSourceLabel(repoPath);
    if (repo) return `${repo} (main repo)`;
  }
  return null;
}

export interface RepoSetupInfo {
  /** `.sideboard/settings.toml` or `.conductor/settings.toml` exists. */
  hasConfig: boolean;
  /** `[scripts] setup = "..."` is defined in the loaded config. */
  hasSetupScript: boolean;
  configLabel: string | null;
}

/** Setup panel state for a thread worktree (falls back to main repo config). */
export function getRepoSetupInfo(
  worktreePath: string,
  repoPath?: string | null,
): RepoSetupInfo {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  return {
    hasConfig: hasWorkspaceHook(worktreePath, repoPath),
    hasSetupScript: Boolean(settings?.setup),
    configLabel: workspaceSettingsSourceLabel(worktreePath, repoPath),
  };
}
