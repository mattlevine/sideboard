/**
 * Pick a Node binary that can actually execute a script path.
 *
 * Electron packages app code in `app.asar`. A system `node` on PATH cannot
 * open files inside the archive (MODULE_NOT_FOUND, empty requireStack).
 * Electron's own binary can, when launched with ELECTRON_RUN_AS_NODE=1.
 */

import { wrapElectronAsNodeLaunch } from '../hook/nested-electron-env.js';
import { run } from '../git/run.js';

export function isAsarPath(filePath: string): boolean {
  // Electron archive paths look like .../app.asar/node_modules/... or .../app.asar
  return /\.asar([/\\]|$)/.test(filePath);
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
  if (!launch.env.ELECTRON_RUN_AS_NODE) {
    return { file: launch.file, args, env: launch.env };
  }
  const wrapped = wrapElectronAsNodeLaunch(launch.file, args);
  return { file: wrapped.file, args: wrapped.args, env: launch.env };
}

/**
 * Resolve how to run `scriptPath` with Node.
 * Prefer a real Node when the script is on a normal filesystem; fall back to
 * Electron-as-Node for asar (and when `node` is missing).
 */
export async function resolveNodeLaunch(scriptPath: string): Promise<NodeLaunch> {
  if (isAsarPath(scriptPath)) {
    return {
      file: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  const whichNode = await run('which', ['node'], { reject: false });
  const nodeBin =
    whichNode.exitCode === 0 && whichNode.stdout.trim()
      ? whichNode.stdout.trim()
      : null;
  if (nodeBin) {
    return { file: nodeBin, env: {} };
  }

  return {
    file: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}
