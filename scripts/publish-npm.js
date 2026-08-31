#!/usr/bin/env node
/**
 * Build and publish @sideboard-ai/core + @sideboard-ai/cli to npm.
 *
 * Expects versions already bumped (e.g. by apps/desktop/scripts/release.js).
 * Auth (first match): NPM_TOKEN / NODE_AUTH_TOKEN, GitHub Actions OIDC
 * (ACTIONS_ID_TOKEN_REQUEST_*), or the logged-in npm user.
 *
 * Usage:
 *   node scripts/publish-npm.js
 *   node scripts/publish-npm.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, {
    cwd: opts.cwd || repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
}

function publishedOnNpm(name, version) {
  try {
    const out = execSync(`npm view ${name}@${version} version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === version;
  } catch {
    return false;
  }
}

function githubOidcAvailable() {
  return Boolean(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  );
}

function ensureNpmAuth() {
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    const token = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = token;
    // Scoped registry auth for this publish only (do not rewrite user ~/.npmrc permanently).
    const npmrc = path.join(os.tmpdir(), `sideboard-npmrc-${process.pid}`);
    fs.writeFileSync(
      npmrc,
      `//registry.npmjs.org/:_authToken=${token}\nalways-auth=true\n`,
    );
    process.env.NPM_CONFIG_USERCONFIG = npmrc;
    console.log('🔐 Using NPM_TOKEN / NODE_AUTH_TOKEN for publish');
    return () => {
      try {
        fs.unlinkSync(npmrc);
      } catch {
        /* ignore */
      }
    };
  }

  if (githubOidcAvailable()) {
    console.log('🔐 Using GitHub Actions OIDC (npm trusted publishing)');
    return () => undefined;
  }

  try {
    const who = execSync('npm whoami', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    console.log(`🔐 npm user: ${who}`);
    return () => undefined;
  } catch {
    throw new Error(
      'Not logged in to npm. Run `npm login`, set NPM_TOKEN / NODE_AUTH_TOKEN, or publish from GitHub Actions with trusted publishing (id-token: write).',
    );
  }
}

const cleanup = dryRun ? () => undefined : ensureNpmAuth();

try {
  const corePkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/core/package.json'), 'utf8'),
  );
  const cliPkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/cli/package.json'), 'utf8'),
  );
  console.log(`📦 Publishing @sideboard-ai/core@${corePkg.version} and @sideboard-ai/cli@${cliPkg.version}`);

  run('pnpm --filter @sideboard-ai/core build');
  run('pnpm --filter @sideboard-ai/cli build');
  run('pnpm --filter @sideboard-ai/cli test');

  const publishArgs = [
    '--access public',
    '--no-git-checks',
    dryRun ? '--dry-run' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const coreName = '@sideboard-ai/core';
  const cliName = '@sideboard-ai/cli';
  const coreDone = !dryRun && publishedOnNpm(coreName, corePkg.version);
  const cliDone = !dryRun && publishedOnNpm(cliName, cliPkg.version);
  if (coreDone && cliDone) {
    console.log(
      `\n⏭  ${coreName}@${corePkg.version} and ${cliName}@${cliPkg.version} already on npm — skip publish`,
    );
    return;
  }

  // Core first — CLI depends on the published version.
  // pnpm publish does not always complete the npm OIDC exchange; use npm on GHA.
  if (githubOidcAvailable() && !process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
    const npmFlags = ['--access public', dryRun ? '--dry-run' : ''].filter(Boolean).join(' ');
    if (!coreDone) run(`npm publish ${npmFlags}`, { cwd: path.join(repoRoot, 'packages/core') });
    else console.log(`⏭  ${coreName}@${corePkg.version} already on npm`);
    if (!cliDone) run(`npm publish ${npmFlags}`, { cwd: path.join(repoRoot, 'packages/cli') });
    else console.log(`⏭  ${cliName}@${cliPkg.version} already on npm`);
  } else {
    if (!coreDone) run(`pnpm --filter @sideboard-ai/core publish ${publishArgs}`);
    else console.log(`⏭  ${coreName}@${corePkg.version} already on npm`);
    if (!cliDone) run(`pnpm --filter @sideboard-ai/cli publish ${publishArgs}`);
    else console.log(`⏭  ${cliName}@${cliPkg.version} already on npm`);
  }

  console.log(
    dryRun
      ? '\n✅ npm dry-run complete'
      : `\n✅ Published @sideboard-ai/core@${corePkg.version} and @sideboard-ai/cli@${cliPkg.version}`,
  );
  console.log('- CLI: npm i -g @sideboard-ai/cli');
  console.log('- MCP: sideboard mcp   (or npx sideboard-mcp)');
} finally {
  cleanup();
}
