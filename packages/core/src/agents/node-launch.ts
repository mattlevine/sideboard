/**
 * Pick a Node binary that can actually execute a script path.
 *
 * Electron packages app code in `app.asar`. A system `node` on PATH cannot
 * open files inside the archive (MODULE_NOT_FOUND, empty requireStack).
 * Electron's own binary can, when launched with ELECTRON_RUN_AS_NODE=1.
 *
 * Cursor's local agent is itself Electron. If Sideboard spawns that agent
 * (or MCP) via Electron-as-Node, Cursor uses `process.execPath` (Sideboard.app)
 * for `.js` children and strips `ELECTRON_RUN_AS_NODE` — nested Chromium then
 * dies at HasCustomHostObject. Prefer a real Node plus extraResources (Cursor
 * runner) or asar-unpacked scripts.
 *
 * Homebrew's unversioned `node` formula is often odd Current and dynamically
 * links Cellar `libuv`. That combo has aborted in `uv_run` while running
 * Cursor's local agent. The packaged app ships official Node 22 in
 * extraResources (`node/bin/node`) and prefers it. Unpackaged / CLI still
 * probe `node -v` and prefer even LTS ≥20 — do not trust keg names
 * (`opt/node@22` can alias Current).
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isElectronLikeCommand,
  wrapElectronAsNodeLaunch,
} from '../hook/nested-electron-env.js';
import { run } from '../git/run.js';
import { packagedBundledNodePath } from './packaged-runtime.js';

/**
 * Node CLIs (Claude Code, OpenCode, Brightsy, Cursor runner) and Node MCP
 * children index the worktree in V8. The default heap (~2–4 GiB) OOMs on
 * large cowboy folders. Raise the ceiling via NODE_OPTIONS so the process
 * and its children inherit it. A larger explicit `--max-old-space-size`
 * is left alone; a smaller one is bumped.
 */
export const AGENT_RUNNER_MAX_OLD_SPACE_MB = 8192;

const MAX_OLD_SPACE_FLAG =
  /(?:^|\s)(--max[-_]old[-_]space[-_]size)(?:[= ](\d+))?(?=\s|$)/;

export function withMaxOldSpaceSize(
  nodeOptions: string | undefined,
  heapMb: number,
): string {
  const existing = (nodeOptions ?? '').trim();
  const match = MAX_OLD_SPACE_FLAG.exec(existing);
  if (match) {
    const current = match[2] ? Number(match[2]) : 0;
    if (Number.isFinite(current) && current >= heapMb) return existing;
    return existing.replace(MAX_OLD_SPACE_FLAG, ` --max-old-space-size=${heapMb}`).trim();
  }
  return existing
    ? `${existing} --max-old-space-size=${heapMb}`
    : `--max-old-space-size=${heapMb}`;
}

export function applyAgentRunnerHeapEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  env.NODE_OPTIONS = withMaxOldSpaceSize(
    env.NODE_OPTIONS,
    AGENT_RUNNER_MAX_OLD_SPACE_MB,
  );
}

function envWithAgentHeap(env: Record<string, string>): Record<string, string> {
  const next = { ...env };
  applyAgentRunnerHeapEnv(next);
  return next as Record<string, string>;
}

export function isAsarPath(filePath: string): boolean {
  // Electron archive paths look like .../app.asar/node_modules/... or .../app.asar
  // Do not treat app.asar.unpacked/... as asar — those files are real.
  if (/\.asar\.unpacked([/\\]|$)/.test(filePath)) return false;
  return /\.asar([/\\]|$)/.test(filePath);
}

/** Sibling path electron-builder writes when `asarUnpack` matches. */
export function unpackedAsarPath(filePath: string): string | null {
  if (!isAsarPath(filePath)) return null;
  const unpacked = filePath.replace(/\.asar(?=[/\\])/, '.asar.unpacked');
  if (unpacked === filePath) return null;
  return existsSync(unpacked) ? unpacked : null;
}

/** Script path a system `node` can actually read. */
export function nodeReadableScriptPath(scriptPath: string): string {
  return unpackedAsarPath(scriptPath) ?? scriptPath;
}

/** Even majors 20+ are LTS; odd majors are Current. */
const PREFERRED_LTS_MAJORS = [24, 22, 20] as const;

export type NodeRuntimeCandidate = {
  path: string;
  version: string;
};

export function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version.trim());
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

/**
 * Higher is better. Cursor's local agent is native-heavy; Homebrew Current
 * (odd majors, shared libuv) has crashed in `uv_run`. Prefer even LTS ≥20.
 * Score the probed version — Homebrew `opt/node@22` can alias Current.
 */
export function scoreNodeForAgentRuntime(candidate: NodeRuntimeCandidate): number {
  const major = parseNodeMajor(candidate.version);
  if (major == null) return Number.NEGATIVE_INFINITY;
  if (major < 20) return major - 100;

  const posix = candidate.path.replace(/\\/g, '/');
  let score = 0;
  if (major % 2 === 0) {
    score += 1000 + major * 10;
  } else {
    score += major;
  }

  // Unversioned Homebrew `node` keg is Current and links Cellar libuv.
  if (/\/Cellar\/node\/\d/.test(posix) && !/\/Cellar\/node@\d+/.test(posix)) {
    score -= 50;
  }
  return score;
}

export function pickPreferredNodeBin(candidates: NodeRuntimeCandidate[]): string | null {
  return pickPreferredNode(candidates)?.path ?? null;
}

export function pickPreferredNode(
  candidates: NodeRuntimeCandidate[],
): NodeRuntimeCandidate | null {
  let best: NodeRuntimeCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreNodeForAgentRuntime(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function versionDirNodeBins(root: string, toBin: (name: string) => string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).map(toBin);
  } catch {
    return [];
  }
}

/** PATH + keg-only Homebrew LTS + nvm/fnm/volta — existence checked later. */
export function defaultNodeBinCandidates(home: string = homedir()): string[] {
  const kegs = ['/opt/homebrew', '/usr/local'].flatMap((prefix) =>
    PREFERRED_LTS_MAJORS.map((major) => join(prefix, 'opt', `node@${major}`, 'bin', 'node')),
  );
  return [
    ...kegs,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    join(home, '.local/share/fnm/aliases/default/bin/node'),
    join(home, '.nvm/current/bin/node'),
    join(home, '.volta/bin/node'),
    join(home, '.asdf/shims/node'),
    join(home, '.local/share/mise/shims/node'),
    ...versionDirNodeBins(join(home, '.nvm', 'versions', 'node'), (name) =>
      join(home, '.nvm', 'versions', 'node', name, 'bin', 'node'),
    ),
    ...versionDirNodeBins(join(home, '.local/share/fnm', 'node-versions'), (name) =>
      join(home, '.local/share/fnm', 'node-versions', name, 'installation', 'bin', 'node'),
    ),
    ...versionDirNodeBins(join(home, '.volta', 'tools', 'image', 'node'), (name) =>
      join(home, '.volta', 'tools', 'image', 'node', name, 'bin', 'node'),
    ),
  ];
}

function uniqueExistingNodeBins(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = raw.trim();
    if (!p || !existsSync(p) || isElectronLikeCommand(p)) continue;
    let key = p;
    try {
      key = realpathSync(p);
    } catch {
      // broken symlink — skip
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function whichAllNode(): Promise<string[]> {
  if (process.platform === 'win32') {
    const located = await run('where', ['node'], { reject: false, timeoutMs: 5_000 });
    if (located.exitCode !== 0) return [];
    return located.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const all = await run('which', ['-a', 'node'], { reject: false, timeoutMs: 5_000 });
  if (all.exitCode === 0 && all.stdout.trim()) {
    return all.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const single = await run('which', ['node'], { reject: false, timeoutMs: 5_000 });
  if (single.exitCode !== 0 || !single.stdout.trim()) return [];
  return [single.stdout.trim()];
}

async function probeNodeVersion(bin: string): Promise<string | null> {
  const probed = await run(bin, ['-v'], { reject: false, timeoutMs: 4_000 });
  if (probed.exitCode !== 0) return null;
  const version = probed.stdout.trim().split(/\r?\n/).find(Boolean);
  return version || null;
}

async function findSystemNode(): Promise<NodeRuntimeCandidate | null> {
  const fromPath = await whichAllNode();
  const bins = uniqueExistingNodeBins([...fromPath, ...defaultNodeBinCandidates()]);
  if (bins.length === 0) return null;

  const probed = await Promise.all(
    bins.map(async (path) => {
      const version = await probeNodeVersion(path);
      return version ? { path, version } : null;
    }),
  );
  return pickPreferredNode(probed.filter((c): c is NodeRuntimeCandidate => c != null));
}

export type NodeLaunch = {
  file: string;
  /** Extra env for the child (merged by caller). */
  env: Record<string, string>;
  /** `node -v` when `file` is a probed system Node. */
  nodeVersion?: string;
};

export type AppliedNodeLaunch = {
  file: string;
  args: string[];
  env: Record<string, string>;
};

/**
 * Combine {@link resolveNodeLaunch} with script args. Electron-as-Node is
 * wrapped so a nested Electron parent cannot leak crashpad/GPU env.
 */
export function applyNodeLaunch(launch: NodeLaunch, args: string[]): AppliedNodeLaunch {
  const readableArgs = args.map(nodeReadableScriptPath);
  if (!launch.env.ELECTRON_RUN_AS_NODE) {
    return {
      file: launch.file,
      args: readableArgs,
      env: envWithAgentHeap(launch.env),
    };
  }
  const wrapped = wrapElectronAsNodeLaunch(launch.file, readableArgs);
  if (process.platform === 'win32') {
    return {
      file: wrapped.file,
      args: wrapped.args,
      env: envWithAgentHeap(launch.env),
    };
  }
  // `/bin/sh` re-exports ELECTRON_RUN_AS_NODE. Omit it from spawn env so a
  // nested Electron parent (Cursor's local agent) does not treat this MCP as
  // Electron-as-Node while merging crashpad onto Sideboard.app.
  const env = envWithAgentHeap(launch.env);
  delete env.ELECTRON_RUN_AS_NODE;
  return { file: wrapped.file, args: wrapped.args, env };
}

/**
 * Resolve how to run `scriptPath` with Node.
 * Prefer a real Node when the script is on a normal filesystem; fall back to
 * Electron-as-Node for asar (and when `node` is missing).
 */
export async function resolveNodeLaunch(scriptPath: string): Promise<NodeLaunch> {
  const script = nodeReadableScriptPath(scriptPath);
  if (!isAsarPath(script)) {
    const bundled = packagedBundledNodePath();
    if (bundled && !isElectronLikeCommand(bundled)) {
      return { file: bundled, env: {} };
    }
    const node = await findSystemNode();
    if (node) {
      return { file: node.path, env: {}, nodeVersion: node.version };
    }
  }

  return {
    file: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}
