#!/usr/bin/env node
/**
 * Bump versions, optionally build/publish the Mac desktop app, and/or publish CLI+MCP to npm.
 *
 * Loads CSC_* / APPLE_* / GH_TOKEN / NPM_TOKEN from apps/desktop/.env when present.
 *
 * Usage (from repo root):
 *   pnpm release                    # patch, desktop + npm, publish
 *   pnpm release minor
 *   pnpm release patch npm          # CLI + MCP (core) only
 *   pnpm release patch mac          # desktop only
 *   pnpm release patch all never    # both, no publish
 *
 * Usage (from apps/desktop):
 *   pnpm run release
 *   pnpm run release patch npm always
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { macNotarizeCliArg, printMacNotarizeSummary } = require('./mac-notarize-flag');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const pkgPath = path.join(desktopRoot, 'package.json');
const rootPkgPath = path.join(repoRoot, 'package.json');
const corePkgPath = path.join(repoRoot, 'packages/core/package.json');
const cliPkgPath = path.join(repoRoot, 'packages/cli/package.json');

function loadEnv() {
  const candidates = [
    path.join(desktopRoot, '.env'),
    path.join(repoRoot, '.env'),
  ];
  let loaded = false;
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] == null) process.env[key] = value;
    }
    console.log(`🔐 Loaded env from ${path.relative(repoRoot, envPath)}`);
    loaded = true;
    break;
  }
  if (!loaded) {
    console.warn(
      '⚠️  No .env found. Copy apps/desktop/.env.example → apps/desktop/.env for signed desktop / npm publish creds.',
    );
  }

  if (!process.env.GH_TOKEN) {
    try {
      const token = execSync('gh auth token', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (token) {
        process.env.GH_TOKEN = token;
        console.log('🔐 Using GH_TOKEN from `gh auth token`');
      }
    } catch {
      /* optional */
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2).filter(Boolean);
  const bump = ['patch', 'minor', 'major'].includes(args[0]) ? args[0] : 'patch';
  let target = 'all';
  let publish = 'always';
  for (const arg of args.slice(1)) {
    if (['mac', 'desktop', 'npm', 'all'].includes(arg)) {
      target = arg === 'desktop' ? 'mac' : arg;
    } else if (['always', 'never'].includes(arg)) {
      publish = arg;
    }
  }
  return {
    bump,
    publish,
    doDesktop: target === 'all' || target === 'mac',
    doNpm: target === 'all' || target === 'npm',
    target,
  };
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, {
    cwd: opts.cwd || desktopRoot,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
}

function getGithubPublishTarget(pkg) {
  const publishConfig = pkg?.build?.publish;
  const publishEntries = Array.isArray(publishConfig) ? publishConfig : [publishConfig];
  const githubEntry = publishEntries.find((entry) => entry && entry.provider === 'github');
  if (!githubEntry?.owner || !githubEntry?.repo) {
    throw new Error(
      'Could not determine GitHub publish target from package.json build.publish.',
    );
  }
  return { owner: githubEntry.owner, repo: githubEntry.repo };
}

function bumpSemver(version, bump) {
  const parts = String(version)
    .split('.')
    .map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid semver in package.json: ${version}`);
  }
  let [major, minor, patch] = parts;
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function writePackageVersion(filePath, version) {
  if (!fs.existsSync(filePath)) return;
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function syncVersions(version) {
  writePackageVersion(pkgPath, version);
  writePackageVersion(rootPkgPath, version);
  writePackageVersion(corePkgPath, version);
  writePackageVersion(cliPkgPath, version);
}

loadEnv();
const { bump, publish, doDesktop, doNpm, target } = parseArgs();
const pkgBefore = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const githubTarget = getGithubPublishTarget(pkgBefore);

if (publish === 'always' && doDesktop && !process.env.GH_TOKEN) {
  throw new Error(
    'GH_TOKEN is required to publish the desktop app. Set it in apps/desktop/.env, run `gh auth login`, or use: pnpm release patch never',
  );
}

if (doDesktop) printMacNotarizeSummary();

const nextVersion = bumpSemver(pkgBefore.version, bump);
console.log(`📦 Bumping version: ${pkgBefore.version} → ${nextVersion} (${bump})`);
console.log(`🎯 Targets: ${target} (desktop=${doDesktop}, npm=${doNpm}), publish=${publish}`);
syncVersions(nextVersion);

if (doNpm) {
  const npmScript = path.join(repoRoot, 'scripts/publish-npm.js');
  const dry = publish === 'never' ? ' --dry-run' : '';
  run(`node ${JSON.stringify(npmScript)}${dry}`, { cwd: repoRoot });
}

if (doDesktop) {
  const notarizeArg = macNotarizeCliArg();
  console.log(`🔨 Building Sideboard desktop ${nextVersion}…`);
  run('pnpm --filter @sideboard-ai/core build', { cwd: repoRoot });
  run('pnpm exec electron-vite build');
  run('node scripts/stage-cursor-runtime.js');

  const publishFlag = `--publish ${publish}`;
  const builderCmd = [
    'pnpm exec electron-builder',
    '--mac',
    notarizeArg,
    publishFlag,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  run(builderCmd);

  // Guard against asar corruption (e.g. file size races while packing).
  const asarPath = path.join(desktopRoot, 'release/mac-arm64/Sideboard.app/Contents/Resources/app.asar');
  if (fs.existsSync(asarPath)) {
    const { createRequire } = require('module');
    const requireFromDesktop = createRequire(path.join(desktopRoot, 'package.json'));
    const asar = requireFromDesktop('@electron/asar');
    const pkgBuf = asar.extractFile(asarPath, 'package.json');
    const text = pkgBuf.toString('utf8');
    if (!text.trimStart().startsWith('{')) {
      throw new Error(
        `Packaged app.asar package.json is corrupt (starts with ${JSON.stringify(text.slice(0, 40))}). Aborting release.`,
      );
    }
    JSON.parse(text);
    console.log('✅ Verified app.asar package.json');
  }

  const appResources = path.join(
    desktopRoot,
    'release/mac-arm64/Sideboard.app/Contents/Resources',
  );
  const cursorRunner = path.join(
    appResources,
    'cursor-runtime/core-dist/agents/cursor-runner.js',
  );
  const cursorRg = path.join(
    appResources,
    `cursor-runtime/node_modules/@cursor/sdk-darwin-arm64/bin/rg`,
  );
  if (!fs.existsSync(cursorRunner) || !fs.existsSync(cursorRg)) {
    throw new Error(
      'Packaged extraResources cursor-runtime is incomplete (runner or rg missing). Aborting release.',
    );
  }
  console.log('✅ Verified extraResources cursor-runtime');
}

const tag = `v${nextVersion}`;
const versionFiles = [pkgPath, rootPkgPath, corePkgPath, cliPkgPath];
try {
  run(`git add ${versionFiles.map((p) => JSON.stringify(p)).join(' ')}`, {
    cwd: repoRoot,
  });
  run(`git commit -m ${JSON.stringify(`Release ${tag}`)}`, { cwd: repoRoot });
  run(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(`Sideboard ${tag}`)}`, {
    cwd: repoRoot,
  });
  console.log(`🏷️  Created git tag ${tag} (push with: git push origin HEAD ${tag})`);
} catch (err) {
  console.warn(
    '⚠️  Version files were updated but git commit/tag was skipped (dirty tree or no changes).',
  );
  console.warn(err instanceof Error ? err.message : String(err));
}

console.log('\n✅ Release complete!');
console.log(`- Version: ${nextVersion}`);
if (doNpm) {
  console.log(`- npm: @sideboard-ai/cli@${nextVersion} + @sideboard-ai/core@${nextVersion} (MCP via sideboard mcp / sideboard-mcp)`);
}
if (doDesktop) {
  const releaseDir = path.join(desktopRoot, 'release');
  const files = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [];
  console.log(`- Desktop artifacts: ${releaseDir}`);
  console.log(`- GitHub: https://github.com/${githubTarget.owner}/${githubTarget.repo}/releases`);
  if (files.includes('latest-mac.yml')) {
    console.log('- Auto-update feed: latest-mac.yml present');
  } else if (publish === 'always') {
    console.log('- Warning: latest-mac.yml missing — auto-update may not work until publish succeeds');
  }
}
if (publish === 'never') {
  console.log('- Publish skipped (dry-run / local only)');
}
