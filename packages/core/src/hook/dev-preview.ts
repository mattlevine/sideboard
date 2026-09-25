import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How a worktree Dev / run script is meant to be used.
 * `url` — open http://localhost:<port> (browser, curl, Playwright).
 * `window` — Electron: the native window is the app; that URL is renderer/HMR only.
 */
export type DevPreview = 'url' | 'window';

const ELECTRON_CMD_RE =
  /\belectron(?:-vite|-forge|-builder|mon)?\b/i;

const PNPM_FILTER_RE =
  /--filter(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/;

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.git',
  '.context',
  '.next',
  '.turbo',
  '.output',
]);

export function parseDevPreview(raw: unknown): DevPreview | undefined {
  return raw === 'url' || raw === 'window' ? raw : undefined;
}

export function commandLooksLikeElectron(command: string): boolean {
  return ELECTRON_CMD_RE.test(command);
}

export function pnpmFilterPackage(command: string): string | null {
  const m = command.match(PNPM_FILTER_RE);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function packageLooksLikeElectron(pkg: Record<string, unknown>): boolean {
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
    ...(pkg.optionalDependencies as Record<string, string> | undefined),
  };
  if (
    deps.electron ||
    deps['electron-vite'] ||
    deps['electron-builder'] ||
    deps['@electron-forge/cli'] ||
    deps['electron-forge']
  ) {
    return true;
  }
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === 'object') {
    for (const value of Object.values(scripts)) {
      if (typeof value === 'string' && commandLooksLikeElectron(value)) {
        return true;
      }
    }
  }
  return false;
}

function findPackageJsonByName(
  root: string,
  name: string,
  budget = 80,
): string | null {
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < budget) {
    const dir = queue.shift()!;
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      seen += 1;
      const pkg = readJsonObject(pkgPath);
      if (pkg?.name === name) return pkgPath;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        SKIP_DIR.has(entry.name) ||
        entry.name.startsWith('.')
      ) {
        continue;
      }
      queue.push(join(dir, entry.name));
    }
  }
  return null;
}

export type RunScriptPreviewInput = {
  command: string;
  preview?: DevPreview;
};

/**
 * Classify a run script: explicit `preview` in settings.toml wins, then the
 * command string, then the `--filter` package (or repo root package.json).
 */
export function classifyRunScriptPreview(opts: {
  command: string;
  preview?: DevPreview;
  worktreePath?: string | null;
}): DevPreview {
  if (opts.preview === 'url' || opts.preview === 'window') return opts.preview;
  if (commandLooksLikeElectron(opts.command)) return 'window';

  const root = opts.worktreePath?.trim();
  if (!root) return 'url';

  const filter = pnpmFilterPackage(opts.command);
  if (filter) {
    if (filter.startsWith('.') || filter.startsWith('/')) {
      const pkg = readJsonObject(join(root, filter, 'package.json'));
      if (pkg && packageLooksLikeElectron(pkg)) return 'window';
    } else {
      const found = findPackageJsonByName(root, filter);
      if (found) {
        const pkg = readJsonObject(found);
        if (pkg && packageLooksLikeElectron(pkg)) return 'window';
        return 'url';
      }
    }
  }

  const rootPkg = readJsonObject(join(root, 'package.json'));
  if (rootPkg && packageLooksLikeElectron(rootPkg)) return 'window';
  return 'url';
}

export function runScriptPreview(
  script: RunScriptPreviewInput | undefined,
  worktreePath?: string | null,
): DevPreview {
  if (!script) return 'url';
  return classifyRunScriptPreview({
    command: script.command,
    preview: script.preview,
    worktreePath,
  });
}

export function activeRunPreview(
  scriptName: string,
  scripts: readonly (RunScriptPreviewInput & { name: string })[],
  worktreePath?: string | null,
): DevPreview {
  return runScriptPreview(
    scripts.find((s) => s.name === scriptName),
    worktreePath,
  );
}

export function annotateDevAccessRuns<T extends { scriptName: string; port: number }>(
  runs: readonly T[],
  scripts: readonly (RunScriptPreviewInput & { name: string })[],
  worktreePath?: string | null,
): Array<T & { preview: DevPreview }> {
  return runs.map((run) => ({
    ...run,
    preview: activeRunPreview(run.scriptName, scripts, worktreePath),
  }));
}
