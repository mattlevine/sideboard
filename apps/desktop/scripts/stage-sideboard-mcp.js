#!/usr/bin/env node
/**
 * Copy CLI/core MCP onto a real filesystem tree under
 * apps/desktop/build/sideboard-mcp. extraResources ships this next to the
 * asar so packaged agents and other apps spawn `node …/run-stdio.js` — never
 * Sideboard.app as Node. `better-sqlite3` is rebuilt for host Node ABI.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const { createRequire } = require('module');
const os = require('os');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const dest = path.join(desktopRoot, 'build', 'sideboard-mcp');
const destNm = path.join(dest, 'node_modules');
const corePkgJson = path.join(repoRoot, 'packages/core/package.json');

function copyTree(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`stage-sideboard-mcp: missing ${from}`);
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
  const entry = req.resolve(name);
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
  throw new Error(`stage-sideboard-mcp: cannot find package.json for ${name}`);
}

function copyPackageAndDeps(name, seen, fromFile) {
  if (seen.has(name)) return;
  seen.add(name);
  const pkgJsonPath = resolvePkgJson(name, fromFile);
  const pkgDir = path.dirname(pkgJsonPath);
  copyTree(pkgDir, path.join(destNm, ...name.split('/')));
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies || {})) {
    copyPackageAndDeps(dep, seen, pkgJsonPath);
  }
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    copyPackageAndDeps(dep, seen, pkgJsonPath);
  }
}

function rebuildBetterSqlite3ForHostNode() {
  const sqliteDir = path.join(destNm, 'better-sqlite3');
  if (!fs.existsSync(path.join(sqliteDir, 'package.json'))) {
    throw new Error('stage-sideboard-mcp: better-sqlite3 missing after copy');
  }
  const env = { ...process.env };
  delete env.npm_config_runtime;
  delete env.npm_config_target;
  env.npm_config_runtime = 'node';
  env.npm_config_target = process.versions.node;
  const result = spawnSync('npm', ['run', 'install'], {
    cwd: sqliteDir,
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `stage-sideboard-mcp: better-sqlite3 host-node rebuild failed:\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }
}

function assertIsolatedMcpNativeLoads() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sideboard-mcp-stage-'));
  try {
    const isolated = path.join(tmp, 'sideboard-mcp');
    fs.cpSync(dest, isolated, { recursive: true });
    const mcp = path.join(isolated, 'core-dist', 'mcp', 'run-stdio.js');
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `require('module').createRequire(${JSON.stringify(mcp)})('better-sqlite3'); console.log('sqlite-ok');`,
      ],
      {
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, NODE_PATH: '' },
      },
    );
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0 || !/sqlite-ok/.test(out)) {
      throw new Error(`Isolated MCP better-sqlite3 failed to load:\n${out}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(destNm, { recursive: true });

copyTree(path.join(repoRoot, 'packages/core/dist'), path.join(dest, 'core-dist'));
copyTree(path.join(repoRoot, 'packages/cli/dist'), path.join(dest, 'cli-dist'));
fs.writeFileSync(
  path.join(dest, 'package.json'),
  `${JSON.stringify({ name: 'sideboard-mcp', private: true, type: 'module' }, null, 2)}\n`,
);

const seen = new Set();
copyPackageAndDeps('better-sqlite3', seen, corePkgJson);
rebuildBetterSqlite3ForHostNode();
assertIsolatedMcpNativeLoads();

const mcp = path.join(dest, 'core-dist', 'mcp', 'run-stdio.js');
const cli = path.join(dest, 'cli-dist', 'index.js');
if (!fs.existsSync(mcp) || !fs.existsSync(cli)) {
  throw new Error(`stage-sideboard-mcp: MCP or CLI entry missing (${mcp}, ${cli})`);
}

console.log(
  `Staged Sideboard MCP at ${path.relative(repoRoot, dest)} (${seen.size} packages)`,
);
