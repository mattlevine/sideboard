#!/usr/bin/env node
/**
 * Copy Cursor runner + @cursor/sdk onto a real filesystem tree under
 * apps/desktop/build/cursor-runtime. electron-builder `asarUnpack` cannot
 * follow pnpm workspace links outside apps/desktop (`must be under …`).
 * extraResources then ships this folder next to the asar so a real `node`
 * can exec the runner without nested Chromium.
 */
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const dest = path.join(desktopRoot, 'build', 'cursor-runtime');

function copyTree(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`stage-cursor-runtime: missing ${from}`);
  }
  const real = fs.realpathSync(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(real, to, { recursive: true, dereference: false, force: true });
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

copyTree(path.join(repoRoot, 'packages/core/dist'), path.join(dest, 'core-dist'));

const cursorPkgs = ['@cursor/sdk', `@cursor/sdk-${process.platform}-${process.arch}`];
for (const pkg of cursorPkgs) {
  const from = path.join(repoRoot, 'node_modules', pkg);
  if (!fs.existsSync(from)) {
    if (pkg === '@cursor/sdk') throw new Error(`stage-cursor-runtime: missing ${from}`);
    continue;
  }
  copyTree(from, path.join(dest, 'node_modules', pkg));
}

const runner = path.join(dest, 'core-dist', 'agents', 'cursor-runner.js');
if (!fs.existsSync(runner)) {
  throw new Error(`stage-cursor-runtime: runner not built (${runner})`);
}

console.log(`Staged Cursor runtime at ${path.relative(repoRoot, dest)}`);
