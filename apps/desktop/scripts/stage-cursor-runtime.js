#!/usr/bin/env node
/**
 * Copy Cursor runner + production deps onto a real filesystem tree under
 * apps/desktop/build/cursor-runtime. Do not use asarUnpack — any unpack
 * glob still calls getRelativePath on pnpm workspace files outside
 * apps/desktop and aborts pack. extraResources ships this folder next
 * to the asar so a real node can exec the runner without nested Chromium.
 *
 * Copying only `@cursor/sdk` is not enough: the runner's ESM graph also
 * imports `execa` / `smol-toml`, and the SDK imports `@bufbuild/protobuf`,
 * `zod`, etc. Those resolve in the repo by walking up to root node_modules;
 * inside Sideboard.app that walk stops at Resources/. Flattening by package
 * name is not enough either (execa@9 vs extract-zip's get-stream@5).
 *
 * MCP stdio lives in a separate extraResources tree (`sideboard-mcp`), not
 * this Cursor runner copy.
 *
 * Resolve deps from packages/core/package.json, not the repo root. A Sideboard
 * thread worktree does not hoist @cursor/sdk to root node_modules — only core
 * depends on it — so createRequire(root package.json) throws every pack.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LOAD_FAILURE_RE,
  assertIsolatedEsmImport,
  copyTree,
  copyProductionDeps,
} = require('./stage-node-deps.js');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const dest = path.join(desktopRoot, 'build', 'cursor-runtime');
const destNm = path.join(dest, 'node_modules');
const corePkg = path.join(repoRoot, 'packages/core/package.json');
const platformSdk = `@cursor/sdk-${process.platform}-${process.arch}`;

function assertIsolatedRunnerLoads() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sideboard-cursor-runtime-'));
  try {
    const isolated = path.join(tmp, 'cursor-runtime');
    fs.cpSync(dest, isolated, { recursive: true });
    const execaEntry = path.join(isolated, 'node_modules', 'execa', 'index.js');
    if (!fs.existsSync(execaEntry)) {
      throw new Error('Isolated cursor-runtime missing execa after copy');
    }
    assertIsolatedEsmImport(execaEntry, 'execa (cursor-runtime)');
    const runner = path.join(isolated, 'core-dist', 'agents', 'cursor-runner.js');
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      input: '',
      timeout: 20000,
      env: { ...process.env, NODE_PATH: '' },
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (LOAD_FAILURE_RE.test(out)) {
      throw new Error(`Isolated cursor-runtime failed to load:\n${out}`);
    }
    if (!/empty stdin/i.test(out)) {
      throw new Error(`Isolated cursor-runtime unexpected output:\n${out}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(destNm, { recursive: true });

copyTree(path.join(repoRoot, 'packages/core/dist'), path.join(dest, 'core-dist'));
fs.writeFileSync(
  path.join(dest, 'package.json'),
  `${JSON.stringify({ name: 'sideboard-cursor-runtime', private: true, type: 'module' }, null, 2)}\n`,
);

const packageCount = copyProductionDeps({
  destNm,
  fromFile: corePkg,
  names: ['@cursor/sdk', 'execa', 'smol-toml'],
  platformSdk,
});

const runner = path.join(dest, 'core-dist', 'agents', 'cursor-runner.js');
if (!fs.existsSync(runner)) {
  throw new Error(`stage-cursor-runtime: runner not built (${runner})`);
}
const rg = path.join(destNm, platformSdk, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
if (!fs.existsSync(rg)) {
  throw new Error(`stage-cursor-runtime: missing ${rg}`);
}

assertIsolatedRunnerLoads();
console.log(
  `Staged Cursor runtime at ${path.relative(repoRoot, dest)} (${packageCount} packages)`,
);
