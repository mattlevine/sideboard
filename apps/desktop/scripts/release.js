#!/usr/bin/env node
/**
 * Bump desktop version, build a signed Mac app, and publish to GitHub Releases.
 *
 * Loads CSC_* / APPLE_* / GH_TOKEN from apps/desktop/.env when present.
 *
 * Usage (from repo root):
 *   pnpm release                 # patch bump, mac, publish
 *   pnpm release minor           # minor bump
 *   pnpm release major never     # major bump, local artifacts only
 *   pnpm release patch mac never
 *
 * Usage (from apps/desktop):
 *   pnpm run release
 *   pnpm run release patch mac always
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
      '⚠️  No .env found. Copy apps/desktop/.env.example → apps/desktop/.env and set CSC_* / APPLE_* / GH_TOKEN for signed releases.',
    );
  }

  // Prefer gh auth token when GH_TOKEN is unset.
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
  let platform = 'mac';
  let publish = 'always';
  for (const arg of args.slice(1)) {
    if (['mac', 'win', 'linux', 'all'].includes(arg)) platform = arg;
    else if (['always', 'never'].includes(arg)) publish = arg;
  }
  if (platform !== 'mac') {
    console.warn(`⚠️  Sideboard currently packages Mac only; using mac (requested: ${platform}).`);
    platform = 'mac';
  }
  return { bump, platform, publish };
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
}

loadEnv();
const { bump, platform, publish } = parseArgs();
const pkgBefore = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const githubTarget = getGithubPublishTarget(pkgBefore);
const notarizeArg = macNotarizeCliArg();

if (publish === 'always' && !process.env.GH_TOKEN) {
  throw new Error(
    'GH_TOKEN is required to publish. Set it in apps/desktop/.env, run `gh auth login`, or use: pnpm release patch never',
  );
}

printMacNotarizeSummary();

const nextVersion = bumpSemver(pkgBefore.version, bump);
console.log(`📦 Bumping version: ${pkgBefore.version} → ${nextVersion} (${bump})`);
syncVersions(nextVersion);

console.log(`🔨 Building Sideboard ${nextVersion} for ${platform} (publish=${publish})…`);
run('pnpm --filter @sideboard/core build', { cwd: repoRoot });
run('pnpm exec electron-vite build');

const publishFlag = `--publish ${publish}`;
const builderCmd = [
  'pnpm exec electron-builder',
  `--${platform}`,
  notarizeArg,
  publishFlag,
]
  .filter(Boolean)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

run(builderCmd);

const tag = `v${nextVersion}`;
try {
  run(
    `git add ${JSON.stringify(pkgPath)} ${JSON.stringify(rootPkgPath)} ${JSON.stringify(corePkgPath)}`,
    { cwd: repoRoot },
  );
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

const releaseDir = path.join(desktopRoot, 'release');
const files = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [];
console.log('\n✅ Release complete!');
console.log(`- Version: ${nextVersion}`);
console.log(`- Artifacts: ${releaseDir}`);
console.log(`- GitHub: https://github.com/${githubTarget.owner}/${githubTarget.repo}/releases`);
if (files.includes('latest-mac.yml')) {
  console.log('- Auto-update feed: latest-mac.yml present');
} else if (publish === 'always') {
  console.log('- Warning: latest-mac.yml missing — auto-update may not work until publish succeeds');
}
if (publish === 'never') {
  console.log('- Publish skipped; upload artifacts manually or rerun with always');
}
