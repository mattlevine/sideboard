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
 * inside Sideboard.app that walk stops at Resources/.
 *
 * MCP stdio lives in a separate extraResources tree (`sideboard-mcp`), not
 * this Cursor runner copy.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const { createRequire } = require('module');
const os = require('os');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const dest = path.join(desktopRoot, 'build', 'cursor-runtime');
const destNm = path.join(dest, 'node_modules');
const repoPkg = path.join(repoRoot, 'package.json');
const platformSdk = `@cursor/sdk-${process.platform}-${process.arch}`;

function copyTree(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`stage-cursor-runtime: missing ${from}`);
  }
  const real = fs.realpathSync(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(real, to, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (src) => {
      if (src === real) return true;
      const rel = path.relative(real, src);
      return !rel.split(path.sep).includes('node_modules');
    },
  });
}

function resolvePkgJson(name, fromFile) {
  const req = createRequire(fromFile);
  const candidates = [
    path.join(path.dirname(fromFile), 'node_modules', ...name.split('/'), 'package.json'),
    path.join(repoRoot, 'node_modules', ...name.split('/'), 'package.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.realpathSync(p);
  }
  let entry;
  try {
    entry = req.resolve(name);
  } catch (err) {
    if (name.startsWith('@cursor/sdk-')) return null;
    throw err;
  }
  let dir = path.dirname(entry);
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === name) return fs.realpathSync(pkgPath);
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`stage-cursor-runtime: cannot find package.json for ${name}`);
}

function copyPackageAndDeps(name, seen, fromFile) {
  if (seen.has(name)) return;
  seen.add(name);
  const pkgJsonPath = resolvePkgJson(name, fromFile);
  if (!pkgJsonPath) return;
  const pkgDir = path.dirname(pkgJsonPath);
  copyTree(pkgDir, path.join(destNm, ...name.split('/')));
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies || {})) {
    copyPackageAndDeps(dep, seen, pkgJsonPath);
  }
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    if (dep.startsWith('@cursor/sdk-') && dep !== platformSdk) continue;
    copyPackageAndDeps(dep, seen, pkgJsonPath);
  }
}

function assertIsolatedRunnerLoads() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sideboard-cursor-runtime-'));
  try {
    const isolated = path.join(tmp, 'cursor-runtime');
    fs.cpSync(dest, isolated, { recursive: true });
    const runner = path.join(isolated, 'core-dist', 'agents', 'cursor-runner.js');
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      input: '',
      timeout: 20000,
      env: { ...process.env, NODE_PATH: '' },
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/i.test(out)) {
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

const seen = new Set();
for (const name of ['@cursor/sdk', 'execa', 'smol-toml']) {
  copyPackageAndDeps(name, seen, repoPkg);
}

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
  `Staged Cursor runtime at ${path.relative(repoRoot, dest)} (${seen.size} packages)`,
);
