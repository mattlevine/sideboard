#!/usr/bin/env node
/**
 * Build and publish @sideboard/core + @sideboard/cli to npm.
 *
 * Expects versions already bumped (e.g. by apps/desktop/scripts/release.js).
 * Uses NPM_TOKEN / NODE_AUTH_TOKEN when set; otherwise the logged-in npm user.
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

  try {
    const who = execSync('npm whoami', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    console.log(`🔐 npm user: ${who}`);
    return () => undefined;
  } catch {
    throw new Error(
      'Not logged in to npm. Run `npm login`, or set NPM_TOKEN / NODE_AUTH_TOKEN.',
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
  console.log(`📦 Publishing @sideboard/core@${corePkg.version} and @sideboard/cli@${cliPkg.version}`);

  run('pnpm --filter @sideboard/core build');
  run('pnpm --filter @sideboard/cli build');
  run('pnpm --filter @sideboard/cli test');

  const publishArgs = [
    '--access public',
    '--no-git-checks',
    dryRun ? '--dry-run' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Core first — CLI depends on the published version.
  run(`pnpm --filter @sideboard/core publish ${publishArgs}`);
  run(`pnpm --filter @sideboard/cli publish ${publishArgs}`);

  console.log(
    dryRun
      ? '\n✅ npm dry-run complete'
      : `\n✅ Published @sideboard/core@${corePkg.version} and @sideboard/cli@${cliPkg.version}`,
  );
  console.log('- CLI: npm i -g @sideboard/cli');
  console.log('- MCP: sideboard mcp   (or npx sideboard-mcp)');
} finally {
  cleanup();
}
