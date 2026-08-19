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
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isElectronLikeCommand,
  wrapElectronAsNodeLaunch,
} from '../hook/nested-electron-env.js';
import { run } from '../git/run.js';

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

const WELL_KNOWN_NODE_BINS = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
];

async function findSystemNode(): Promise<string | null> {
  const whichNode = await run('which', ['node'], { reject: false });
  const fromWhich =
    whichNode.exitCode === 0 && whichNode.stdout.trim()
      ? whichNode.stdout.trim()
      : '';
  if (fromWhich && !isElectronLikeCommand(fromWhich)) return fromWhich;
  const fallbacks = [
    ...WELL_KNOWN_NODE_BINS,
    join(homedir(), '.local/share/fnm/aliases/default/bin/node'),
    join(homedir(), '.nvm/current/bin/node'),
  ];
  for (const bin of fallbacks) {
    if (existsSync(bin) && !isElectronLikeCommand(bin)) return bin;
  }
  return null;
}

export type NodeLaunch = {
  file: string;
  /** Extra env for the child (merged by caller). */
  env: Record<string, string>;
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
    return { file: launch.file, args: readableArgs, env: launch.env };
  }
  const wrapped = wrapElectronAsNodeLaunch(launch.file, readableArgs);
  if (process.platform === 'win32') {
    return { file: wrapped.file, args: wrapped.args, env: launch.env };
  }
  // `/bin/sh` re-exports ELECTRON_RUN_AS_NODE. Omit it from spawn env so a
  // nested Electron parent (Cursor's local agent) does not treat this MCP as
  // Electron-as-Node while merging crashpad onto Sideboard.app.
  const env = { ...launch.env };
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
    const nodeBin = await findSystemNode();
    if (nodeBin) {
      return { file: nodeBin, env: {} };
    }
  }

  return {
    file: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}
