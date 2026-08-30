#!/usr/bin/env node
/**
 * Copy CLI/core MCP onto a real filesystem tree under
 * apps/desktop/build/sideboard-mcp. extraResources ships this next to the
 * asar so packaged agents and other apps spawn `node …/run-stdio.js` — never
 * Sideboard.app as Node.
 *
 * Copying only `better-sqlite3` is not enough: tsup leaves `@modelcontextprotocol/sdk`,
 * `execa`, `zod`, `@cursor/sdk`, etc. as runtime imports. Those resolve in the
 * repo by walking up to root node_modules; inside Sideboard.app that walk
 * stops at Resources/. Rebuild sqlite for the **bundled** official Node ABI
 * (not Homebrew Current on PATH) after the copy.
 *
 * Flattening by package name is not enough either: execa@9 needs ESM
 * get-stream@9 (`getStreamAsArray`) while extract-zip needs CJS get-stream@5.
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
const { bundledNodeDestBin, stageBundledNode } = require('./stage-bundled-node.js');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const dest = path.join(desktopRoot, 'build', 'sideboard-mcp');
const destNm = path.join(dest, 'node_modules');
const corePkgJson = path.join(repoRoot, 'packages/core/package.json');

function findNpmCliJs() {
  try {
    return require.resolve('npm/bin/npm-cli.js');
  } catch {
    // not resolvable from this node
  }
  const which = spawnSync('which', ['npm'], { encoding: 'utf8' });
  const npmBin = which.stdout.trim();
  if (which.status === 0 && npmBin) {
    const prefix = spawnSync(npmBin, ['prefix', '-g'], { encoding: 'utf8' });
    if (prefix.status === 0) {
      const cli = path.join(prefix.stdout.trim(), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (fs.existsSync(cli)) return cli;
    }
  }
  throw new Error('stage-sideboard-mcp: cannot find npm/bin/npm-cli.js to rebuild sqlite');
}

function rebuildBetterSqlite3ForBundledNode(nodeBin) {
  const sqliteDir = path.join(destNm, 'better-sqlite3');
  if (!fs.existsSync(path.join(sqliteDir, 'package.json'))) {
    throw new Error('stage-sideboard-mcp: better-sqlite3 missing after copy');
  }
  const target = spawnSync(nodeBin, ['-p', 'process.versions.node'], { encoding: 'utf8' });
  if (target.status !== 0 || !target.stdout.trim()) {
    throw new Error(`stage-sideboard-mcp: bundled node -p process.versions.node failed:\n${target.stderr}`);
  }
  const env = { ...process.env };
  delete env.npm_config_runtime;
  delete env.npm_config_target;
  env.npm_config_runtime = 'node';
  env.npm_config_target = target.stdout.trim();
  // Run npm's CLI *with* the bundled binary so lifecycle scripts (prebuild-install)
  // see that Node's ABI — Homebrew npm's shebang would rebuild for Cellar node.
  const result = spawnSync(nodeBin, [findNpmCliJs(), 'run', 'install'], {
    cwd: sqliteDir,
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `stage-sideboard-mcp: better-sqlite3 bundled-node rebuild failed:\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }
}

function assertIsolatedMcpLoads(nodeBin) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sideboard-mcp-stage-'));
  try {
    const isolated = path.join(tmp, 'sideboard-mcp');
    fs.cpSync(dest, isolated, { recursive: true });
    const mcp = path.join(isolated, 'core-dist', 'mcp', 'run-stdio.js');
    const sqlite = spawnSync(
      nodeBin,
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
    const sqliteOut = `${sqlite.stdout || ''}${sqlite.stderr || ''}`;
    if (sqlite.status !== 0 || !/sqlite-ok/.test(sqliteOut)) {
      throw new Error(`Isolated MCP better-sqlite3 failed to load:\n${sqliteOut}`);
    }

    const execaEntry = path.join(isolated, 'node_modules', 'execa', 'index.js');
    if (!fs.existsSync(execaEntry)) {
      throw new Error('Isolated MCP missing execa after copy');
    }
    assertIsolatedEsmImport(execaEntry, 'execa (MCP)');

    const result = spawnSync(nodeBin, [mcp], {
      encoding: 'utf8',
      input: '',
      timeout: 8000,
      env: {
        ...process.env,
        NODE_PATH: '',
        SIDEBOARD_APP_DATA: path.join(tmp, 'app-data'),
      },
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (LOAD_FAILURE_RE.test(out)) {
      throw new Error(`Isolated MCP run-stdio failed to load:\n${out}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  await stageBundledNode();
  const nodeBin = bundledNodeDestBin();
  if (!fs.existsSync(nodeBin)) {
    throw new Error(`stage-sideboard-mcp: bundled Node missing (${nodeBin})`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(destNm, { recursive: true });

  copyTree(path.join(repoRoot, 'packages/core/dist'), path.join(dest, 'core-dist'));
  copyTree(path.join(repoRoot, 'packages/cli/dist'), path.join(dest, 'cli-dist'));
  const detachedSrc = path.join(repoRoot, 'scripts/detached-job.js');
  const detachedDest = path.join(dest, 'scripts/detached-job.js');
  if (!fs.existsSync(detachedSrc)) {
    throw new Error(`stage-sideboard-mcp: missing ${detachedSrc}`);
  }
  fs.mkdirSync(path.dirname(detachedDest), { recursive: true });
  fs.copyFileSync(detachedSrc, detachedDest);
  fs.writeFileSync(
    path.join(dest, 'package.json'),
    `${JSON.stringify({ name: 'sideboard-mcp', private: true, type: 'module' }, null, 2)}\n`,
  );

  const corePkg = JSON.parse(fs.readFileSync(corePkgJson, 'utf8'));
  const packageCount = copyProductionDeps({
    destNm,
    fromFile: corePkgJson,
    names: Object.keys(corePkg.dependencies || {}),
  });

  rebuildBetterSqlite3ForBundledNode(nodeBin);
  assertIsolatedMcpLoads(nodeBin);

  const mcp = path.join(dest, 'core-dist', 'mcp', 'run-stdio.js');
  const cli = path.join(dest, 'cli-dist', 'index.js');
  if (!fs.existsSync(mcp) || !fs.existsSync(cli)) {
    throw new Error(`stage-sideboard-mcp: MCP or CLI entry missing (${mcp}, ${cli})`);
  }

  console.log(
    `Staged Sideboard MCP at ${path.relative(repoRoot, dest)} (${packageCount} packages)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
