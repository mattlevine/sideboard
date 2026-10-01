import { execFile as execFileCb, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorktreeOpener, WorktreeOpenerId } from '@sideboard-ai/core';

const execFileAsync = promisify(execFileCb);

/** Always the absolute macOS `open` — GUI apps launched from the Dock often lack PATH. */
export const MAC_OPEN = '/usr/bin/open';

export type WorktreeOpenerSpec = {
  id: WorktreeOpenerId;
  label: string;
  kbd: string;
  /** Names for `open -a` (tried in order). */
  appNames: string[];
  /** Candidate `.app` bundles for icons (`~/` is expanded). */
  bundlePaths: string[];
  /** `Contents/Resources` icon names (`CFBundleIconFile`; `.icns` optional). */
  iconFiles: string[];
};

export const WORKTREE_OPENERS: WorktreeOpenerSpec[] = [
  {
    id: 'finder',
    label: 'Finder',
    kbd: '1',
    appNames: ['Finder'],
    bundlePaths: ['/System/Library/CoreServices/Finder.app'],
    iconFiles: ['Finder.icns', 'Finder'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kbd: '2',
    appNames: ['Cursor'],
    bundlePaths: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
    iconFiles: ['Cursor.icns'],
  },
  {
    id: 'code',
    label: 'VS Code',
    kbd: '3',
    appNames: ['Visual Studio Code', 'Visual Studio Code - Insiders', 'Code'],
    bundlePaths: [
      '/Applications/Visual Studio Code.app',
      '/Applications/Visual Studio Code - Insiders.app',
      '/Applications/Code.app',
      '~/Applications/Visual Studio Code.app',
      '~/Applications/Visual Studio Code - Insiders.app',
    ],
    iconFiles: ['Code.icns', 'Code - Insiders.icns'],
  },
  {
    id: 'xcode',
    label: 'Xcode',
    kbd: '4',
    appNames: ['Xcode'],
    bundlePaths: ['/Applications/Xcode.app'],
    iconFiles: ['Xcode.icns', 'Xcode'],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kbd: '5',
    appNames: ['Terminal'],
    bundlePaths: [
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Utilities/Terminal.app',
    ],
    iconFiles: ['Terminal.icns', 'Terminal'],
  },
  {
    id: 'datagrip',
    label: 'DataGrip',
    kbd: '6',
    appNames: ['DataGrip'],
    bundlePaths: [
      '/Applications/DataGrip.app',
      '~/Applications/DataGrip.app',
      '~/Applications/JetBrains Toolbox/DataGrip.app',
    ],
    iconFiles: ['datagrip.icns', 'DataGrip.icns'],
  },
];

const OPENER_IDS = new Set<string>(WORKTREE_OPENERS.map((s) => s.id));

export function isWorktreeOpenerId(value: string): value is WorktreeOpenerId {
  return OPENER_IDS.has(value);
}

export function openerSpec(id: WorktreeOpenerId): WorktreeOpenerSpec {
  const spec = WORKTREE_OPENERS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown worktree opener: ${id}`);
  return spec;
}

export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return home + path.slice(1);
  return path;
}

export function resolveBundlePath(
  spec: WorktreeOpenerSpec,
  opts: { home: string; exists: (path: string) => boolean },
): string | null {
  for (const raw of spec.bundlePaths) {
    const path = expandHome(raw, opts.home);
    if (opts.exists(path)) return path;
  }
  return null;
}

export function iconFileCandidates(iconFile: string): string[] {
  if (iconFile.endsWith('.icns')) return [iconFile];
  return [`${iconFile}.icns`, iconFile];
}

/** Path to the `.icns` inside an app bundle, when present. */
export function resolveBundleIconPath(
  bundlePath: string,
  opts: { exists: (path: string) => boolean; iconFiles: string[] },
): string | null {
  const resources = join(bundlePath, 'Contents', 'Resources');
  for (const raw of opts.iconFiles) {
    for (const name of iconFileCandidates(raw)) {
      const path = join(resources, name);
      if (opts.exists(path)) return path;
    }
  }
  return null;
}

/** Map `openInEditor` / SIDEBOARD_EDITOR names onto a known macOS app. */
export function openerIdForEditor(editor: string): WorktreeOpenerId | null {
  const n = editor.trim().toLowerCase();
  if (!n) return null;
  if (n === 'finder') return 'finder';
  if (n === 'cursor') return 'cursor';
  if (
    n === 'code' ||
    n === 'vscode' ||
    n === 'vs code' ||
    n === 'visual studio code' ||
    n === 'code-insiders'
  ) {
    return 'code';
  }
  if (n === 'xcode') return 'xcode';
  if (n === 'terminal') return 'terminal';
  if (n === 'datagrip' || n === 'data grip') return 'datagrip';
  return null;
}

export function openWorktreeArgs(appName: string, folder: string): { file: string; args: string[] } {
  return { file: MAC_OPEN, args: ['-a', appName, folder] };
}

/**
 * Reveal a child of the worktree so Finder shows the folder's contents
 * (`showItemInFolder` on the directory itself only selects it in the parent).
 */
export function finderRevealTarget(folder: string, entries: string[]): string {
  const names = entries.filter((e) => e && e !== '.' && e !== '..');
  const child = names.find((e) => !e.startsWith('.')) ?? names[0];
  return child ? join(folder, child) : folder;
}

/** Launch Services reveal — no Apple Events / Automation permission. */
export function finderRevealArgs(folder: string): { file: string; args: string[] } {
  return { file: MAC_OPEN, args: ['-R', folder] };
}

/**
 * `open -a Finder <dir>` is a no-op. Reveal the item, then activate Finder
 * with no file argument so it comes to the front (current Space).
 */
export function finderLaunchCommands(revealPath: string): Array<{ file: string; args: string[] }> {
  return [finderRevealArgs(revealPath), { file: MAC_OPEN, args: ['-a', 'Finder'] }];
}

/** Host Electron env can make `/usr/bin/open` a no-op. */
export function cleanOpenEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (key.startsWith('ELECTRON_') || key.startsWith('CHROME_')) delete out[key];
  }
  return out;
}

export function isMissingAppError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  return (
    code === 'ENOENT' ||
    /ENOENT/i.test(msg) ||
    /unable to find application/i.test(msg) ||
    /spawn\s+\S+\s+ENOENT/i.test(msg)
  );
}

export function formatOpenWorktreeError(err: unknown, spec: WorktreeOpenerSpec): string {
  if (isMissingAppError(err)) {
    return `${spec.label} isn’t installed on this Mac (or macOS couldn’t find the app).`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const first = msg.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? msg;
  return `Couldn’t open ${spec.label}: ${first}`;
}

export type OpenFolderDeps = {
  execFile: (file: string, args: string[]) => Promise<void>;
  exists: (path: string) => boolean;
  home: string;
};

export async function openFolderWithApp(
  id: WorktreeOpenerId,
  folder: string,
  deps: OpenFolderDeps,
): Promise<void> {
  const spec = openerSpec(id);
  if (!folder || !deps.exists(folder)) {
    throw new Error(`Worktree folder is missing:\n${folder}`);
  }
  if (id === 'finder') {
    for (const { file, args } of finderLaunchCommands(folder)) {
      await deps.execFile(file, args);
    }
    return;
  }
  let lastErr: unknown;
  for (const appName of spec.appNames) {
    const { file, args } = openWorktreeArgs(appName, folder);
    try {
      await deps.execFile(file, args);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(formatOpenWorktreeError(lastErr, spec));
}

export type OpenerBundle = {
  id: WorktreeOpenerId;
  label: string;
  kbd: string;
  installed: boolean;
  bundlePath: string | null;
  iconPath: string | null;
};

export function listOpenerBundles(opts: {
  home: string;
  exists: (path: string) => boolean;
}): OpenerBundle[] {
  return WORKTREE_OPENERS.map((spec) => {
    const bundlePath = resolveBundlePath(spec, opts);
    const iconPath = bundlePath
      ? resolveBundleIconPath(bundlePath, { exists: opts.exists, iconFiles: spec.iconFiles })
      : null;
    return {
      id: spec.id,
      label: spec.label,
      kbd: spec.kbd,
      installed: spec.id === 'finder' || bundlePath != null,
      bundlePath,
      iconPath,
    };
  });
}

export type IcnsToPngDeps = {
  execFileSync: (file: string, args: string[]) => void;
  readFileSync: (path: string) => Buffer;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string) => void;
  tmpdir: () => string;
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Convert a macOS `.icns` to a PNG data URL (`sips` — Electron's icns loader is empty here). */
export function pngDataUrlFromIcns(icnsPath: string, deps: IcnsToPngDeps): string | null {
  const dir = deps.mkdtempSync(join(deps.tmpdir(), 'sb-opener-icon-'));
  const out = join(dir, 'icon.png');
  try {
    deps.execFileSync('/usr/bin/sips', [
      '-z',
      '64',
      '64',
      '-s',
      'format',
      'png',
      icnsPath,
      '--out',
      out,
    ]);
    const buf = deps.readFileSync(out);
    if (!buf || buf.length < 24 || buf.subarray(0, 4).compare(PNG_MAGIC) !== 0) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    try {
      deps.rmSync(dir);
    } catch {
      /* ignore */
    }
  }
}

export function pngDataUrlFromIcnsFile(icnsPath: string): string | null {
  return pngDataUrlFromIcns(icnsPath, {
    execFileSync: (file, args) => {
      execFileSync(file, args, { stdio: 'ignore' });
    },
    readFileSync,
    mkdtempSync,
    rmSync: (path) => rmSync(path, { recursive: true, force: true }),
    tmpdir,
  });
}

export async function execMacOpen(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args, { timeout: 15_000, env: cleanOpenEnv() });
}

export async function openWorktreeFolder(id: WorktreeOpenerId, folder: string): Promise<void> {
  await openFolderWithApp(id, folder, {
    execFile: execMacOpen,
    exists: existsSync,
    home: homedir(),
  });
}

export function listWorktreeOpenerBundles(): OpenerBundle[] {
  return listOpenerBundles({ home: homedir(), exists: existsSync });
}

export function formatSpawnError(err: unknown, file: string): string {
  if (isMissingAppError(err)) {
    return `Couldn’t find “${file}” on this Mac.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const first = msg.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? msg;
  return `Couldn’t open “${file}”: ${first}`;
}

export async function spawnDetached(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: 'ignore',
      env: cleanOpenEnv(),
    });
    child.once('error', (err) => {
      reject(new Error(formatSpawnError(err, file)));
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function toWorktreeOpener(bundle: OpenerBundle, iconDataUrl: string | null): WorktreeOpener {
  return {
    id: bundle.id,
    label: bundle.label,
    kbd: bundle.kbd,
    installed: bundle.installed,
    iconDataUrl: iconDataUrl || null,
  };
}
