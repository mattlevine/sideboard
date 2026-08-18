import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { findConventionSetup } from './convention-setup.js';
import { hasCursorWorktreeSetup } from './cursor-worktrees.js';

export type RunMode = 'concurrent' | 'nonconcurrent';

export interface RunScript {
  name: string;
  command: string;
  default?: boolean;
  /** Lucide-style icon name (Conductor-compatible). */
  icon?: string;
  /** Where the script is available: local, cloud, or both. */
  availableIn?: Array<'local' | 'cloud'>;
}

export interface RepoSettings {
  /** Which file family was loaded */
  source: 'sideboard' | 'conductor';
  setup?: string;
  /** Script run before archive/purge tears down the worktree. */
  archive?: string;
  /** concurrent = multiple workspaces may run scripts; nonconcurrent = one at a time. */
  runMode: RunMode;
  filesToCopy?: string[];
  /** Glob patterns from settings (Conductor file_include_globs). */
  fileIncludeGlobs?: string[];
  runScripts: RunScript[];
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

/** Parsed file before defaults / merge finalization. */
interface ParsedSettings {
  source: 'sideboard' | 'conductor';
  setup?: string;
  archive?: string;
  /** Only set when `scripts.run_mode` is present in the file. */
  runMode?: RunMode;
  filesToCopy?: string[];
  fileIncludeGlobs?: string[];
  runScripts: RunScript[];
  worktreesRoot?: string;
  editor?: string;
  prompts?: RepoSettings['prompts'];
}

function expandHome(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function parseAvailableIn(raw: unknown): Array<'local' | 'cloud'> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<'local' | 'cloud'> = [];
  for (const item of raw) {
    if (item === 'local' || item === 'cloud') out.push(item);
  }
  return out.length ? out : undefined;
}

function parseSettingsFile(
  path: string,
  source: 'sideboard' | 'conductor',
): ParsedSettings | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const data = parseToml(raw) as Record<string, unknown>;

  const scripts = (data.scripts ?? {}) as Record<string, unknown>;
  const setup = typeof scripts.setup === 'string' ? scripts.setup : undefined;
  const archive = typeof scripts.archive === 'string' ? scripts.archive : undefined;
  const runMode: RunMode | undefined =
    'run_mode' in scripts
      ? scripts.run_mode === 'nonconcurrent'
        ? 'nonconcurrent'
        : 'concurrent'
      : undefined;

  const filesToCopy: string[] = [];
  const files = data.files as { copy?: string[] } | undefined;
  if (Array.isArray(files?.copy)) {
    filesToCopy.push(...files.copy.map(String));
  }
  const copySection = data['files-to-copy'] as { paths?: string[] } | undefined;
  if (Array.isArray(copySection?.paths)) {
    filesToCopy.push(...copySection.paths.map(String));
  }

  const fileIncludeGlobs: string[] = [];
  if (Array.isArray(data.file_include_globs)) {
    fileIncludeGlobs.push(...data.file_include_globs.map(String));
  }
  const filesGlobs = files as { include?: string[]; include_globs?: string[] } | undefined;
  if (Array.isArray(filesGlobs?.include)) {
    fileIncludeGlobs.push(...filesGlobs.include.map(String));
  }
  if (Array.isArray(filesGlobs?.include_globs)) {
    fileIncludeGlobs.push(...filesGlobs.include_globs.map(String));
  }

  const runScripts: RunScript[] = [];
  const run = scripts.run as
    | string
    | Record<
        string,
        {
          command?: string;
          default?: boolean;
          icon?: string;
          available_in?: unknown;
        }
      >
    | undefined;

  // Legacy single-string scripts.run
  if (typeof run === 'string' && run.trim()) {
    runScripts.push({ name: 'dev', command: run, default: true });
  } else if (run && typeof run === 'object') {
    for (const [name, value] of Object.entries(run)) {
      if (value && typeof value.command === 'string') {
        runScripts.push({
          name,
          command: value.command,
          default: Boolean(value.default),
          icon: typeof value.icon === 'string' ? value.icon : undefined,
          availableIn: parseAvailableIn(value.available_in),
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
    archive,
    runMode,
    filesToCopy: filesToCopy.length ? filesToCopy : undefined,
    fileIncludeGlobs: fileIncludeGlobs.length ? fileIncludeGlobs : undefined,
    runScripts,
    worktreesRoot,
    editor,
    prompts: hasPrompts ? prompts : undefined,
  };
}

function mergeRunScripts(base: RunScript[], overlay: RunScript[]): RunScript[] {
  const byName = new Map<string, RunScript>();
  for (const s of base) byName.set(s.name, s);
  for (const s of overlay) byName.set(s.name, s);
  return [...byName.values()];
}

/**
 * Overlay wins for defined scalar fields; run scripts merge by name (overlay wins).
 */
function mergeSettings(
  base: ParsedSettings | null,
  overlay: ParsedSettings | null,
): ParsedSettings | null {
  if (!base) return overlay;
  if (!overlay) return base;

  const prompts = {
    renameBranch: overlay.prompts?.renameBranch ?? base.prompts?.renameBranch,
    createPr: overlay.prompts?.createPr ?? base.prompts?.createPr,
    general: overlay.prompts?.general ?? base.prompts?.general,
  };
  const hasPrompts = Boolean(prompts.renameBranch || prompts.createPr || prompts.general);

  return {
    source: overlay.source,
    setup: overlay.setup ?? base.setup,
    archive: overlay.archive ?? base.archive,
    runMode: overlay.runMode ?? base.runMode,
    filesToCopy: overlay.filesToCopy ?? base.filesToCopy,
    fileIncludeGlobs: overlay.fileIncludeGlobs ?? base.fileIncludeGlobs,
    runScripts: mergeRunScripts(base.runScripts, overlay.runScripts),
    worktreesRoot: overlay.worktreesRoot ?? base.worktreesRoot,
    editor: overlay.editor ?? base.editor,
    prompts: hasPrompts ? prompts : undefined,
  };
}

function finalizeSettings(parsed: ParsedSettings | null): RepoSettings | null {
  if (!parsed) return null;
  return {
    ...parsed,
    runMode: parsed.runMode ?? 'concurrent',
    runScripts: parsed.runScripts,
  };
}

function familyFiles(
  rootPath: string,
  source: 'sideboard' | 'conductor',
): { toml: string; local: string } {
  const dir = join(rootPath, `.${source}`);
  return {
    toml: join(dir, 'settings.toml'),
    local: join(dir, 'settings.local.toml'),
  };
}

function familyExists(rootPath: string, source: 'sideboard' | 'conductor'): boolean {
  const files = familyFiles(rootPath, source);
  return existsSync(files.toml) || existsSync(files.local);
}

/** Prefer `.sideboard`, then `.conductor`. */
function detectFamily(rootPath: string): 'sideboard' | 'conductor' | null {
  if (familyExists(rootPath, 'sideboard')) return 'sideboard';
  if (familyExists(rootPath, 'conductor')) return 'conductor';
  return null;
}

function loadCommittedToml(
  rootPath: string,
  source: 'sideboard' | 'conductor',
): ParsedSettings | null {
  return parseSettingsFile(familyFiles(rootPath, source).toml, source);
}

function loadLocalToml(
  rootPath: string,
  source: 'sideboard' | 'conductor',
): ParsedSettings | null {
  return parseSettingsFile(familyFiles(rootPath, source).local, source);
}

/** Any settings.local.toml under .sideboard or .conductor (sideboard wins on conflict). */
function loadAnyLocal(rootPath: string): ParsedSettings | null {
  return mergeSettings(
    loadLocalToml(rootPath, 'conductor'),
    loadLocalToml(rootPath, 'sideboard'),
  );
}

function normPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * Load settings for a single checkout root.
 * Prefer `.sideboard`, fall back to `.conductor`. Overlay `settings.local.toml`.
 */
export function loadRepoSettings(repoPath: string): RepoSettings | null {
  const family = detectFamily(repoPath);
  if (!family) return null;
  const merged = mergeSettings(
    loadCommittedToml(repoPath, family),
    loadLocalToml(repoPath, family),
  );
  return finalizeSettings(merged);
}

/**
 * Settings for a thread workspace.
 *
 * Scripts always run with cwd = worktree (not the main repo). Config resolution
 * matches Conductor:
 * 1. Committed `settings.toml` from the worktree (branch snapshot), else main repo
 * 2. Overlay main-repo `settings.local.toml` (machine-local, applies to all workspaces)
 * 3. Overlay worktree `settings.local.toml` if present
 */
export function loadWorkspaceSettings(
  worktreePath: string,
  repoPath?: string | null,
): RepoSettings | null {
  const wtFamily = detectFamily(worktreePath);
  const repoFamily =
    repoPath && normPath(repoPath) !== normPath(worktreePath)
      ? detectFamily(repoPath)
      : null;

  const wtToml = wtFamily ? loadCommittedToml(worktreePath, wtFamily) : null;
  const repoToml =
    repoPath && repoFamily ? loadCommittedToml(repoPath, repoFamily) : null;

  // Base = worktree committed config, else main repo committed config.
  let merged: ParsedSettings | null = wtToml ?? repoToml;

  // Conductor: project overrides on the main checkout apply to every workspace.
  if (repoPath && normPath(repoPath) !== normPath(worktreePath)) {
    merged = mergeSettings(merged, loadAnyLocal(repoPath));
  }

  // Rare: local overrides inside the worktree itself.
  merged = mergeSettings(merged, loadAnyLocal(worktreePath));

  return finalizeSettings(merged);
}

/** @deprecated use loadRepoSettings */
export function loadConductorSettings(repoPath: string): RepoSettings | null {
  return loadRepoSettings(repoPath);
}

export function hasRepoHook(repoPath: string): boolean {
  return detectFamily(repoPath) !== null;
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
  const family = detectFamily(rootPath);
  if (!family) return null;
  const files = familyFiles(rootPath, family);
  if (existsSync(files.toml) && existsSync(files.local)) {
    return `.${family}/settings.toml + local`;
  }
  if (existsSync(files.local)) return `.${family}/settings.local.toml`;
  return `.${family}/settings.toml`;
}

/** Label including whether config was found in the worktree vs main repo. */
export function workspaceSettingsSourceLabel(
  worktreePath: string,
  repoPath?: string | null,
): string | null {
  const wt = settingsSourceLabel(worktreePath);
  if (wt) return `${wt} (worktree)`;
  if (repoPath && normPath(repoPath) !== normPath(worktreePath)) {
    const repo = settingsSourceLabel(repoPath);
    if (repo) return `${repo} (main repo)`;
  }
  return null;
}

export interface RepoSetupInfo {
  /** `.sideboard` / `.conductor` settings, Cursor worktrees.json, or a conventional setup script. */
  hasConfig: boolean;
  /** A setup command will run on new worktrees (settings, Cursor json, or script/setup). */
  hasSetupScript: boolean;
  configLabel: string | null;
}

/** Setup panel state for a thread worktree (falls back to main repo config). */
export function getRepoSetupInfo(
  worktreePath: string,
  repoPath?: string | null,
): RepoSetupInfo {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  const convention = findConventionSetup(worktreePath, repoPath);
  const cursor = hasCursorWorktreeSetup(worktreePath, repoPath);
  const hasSetupScript = Boolean(settings?.setup) || cursor || Boolean(convention);
  let configLabel = workspaceSettingsSourceLabel(worktreePath, repoPath);
  if (!settings?.setup) {
    if (convention) configLabel = convention.source;
    else if (cursor) {
      configLabel = hasCursorWorktreeSetup(worktreePath)
        ? '.cursor/worktrees.json (worktree)'
        : '.cursor/worktrees.json (main repo)';
    }
  }
  return {
    hasConfig: hasWorkspaceHook(worktreePath, repoPath) || cursor || Boolean(convention),
    hasSetupScript,
    configLabel,
  };
}
