#!/usr/bin/env node
/**
 * Pack / notarize / publish the Mac desktop app in a new process group so a
 * Sideboard or Cursor worktree turn can exit (or get SIGTERM) without killing
 * the 15–40 minute electron-builder + Apple notary job.
 *
 * Does not bump versions. Bump first (`release.js patch mac bump-only`) or
 * continue after an interrupted `pnpm release` that already wrote package.json.
 *
 * Usage (repo root or apps/desktop):
 *   node apps/desktop/scripts/release-mac-detached.js
 *   node apps/desktop/scripts/release-mac-detached.js --status
 *
 * Log/pid live under apps/desktop/release/ (gitignored).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const releaseDir = path.join(desktopRoot, 'release');
const logPath = path.join(releaseDir, 'release.log');
const pidPath = path.join(releaseDir, 'release.pid');

function loadEnv() {
  const candidates = [
    path.join(desktopRoot, '.env'),
    path.join(repoRoot, '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] == null) process.env[key] = value;
    }
    break;
  }
  if (!process.env.GH_TOKEN) {
    try {
      const token = execSync('gh auth token', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (token) process.env.GH_TOKEN = token;
    } catch {
      /* optional */
    }
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!fs.existsSync(pidPath)) return null;
  const n = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  return Number.isInteger(n) ? n : null;
}

function tailLog(maxLines = 40) {
  if (!fs.existsSync(logPath)) return '(no log yet)';
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  return lines.slice(-maxLines).join('\n');
}

function logEndedOk() {
  if (!fs.existsSync(logPath)) return false;
  return fs.readFileSync(logPath, 'utf8').includes('RELEASE_BUILD_OK');
}

function printStatus() {
  const pid = readPid();
  const running = pid != null && isAlive(pid);
  const ok = logEndedOk();
  console.log(`pid: ${pid ?? '(none)'} ${running ? '(running)' : '(not running)'}`);
  console.log(`log: ${logPath}`);
  console.log(`ok: ${ok ? 'yes' : 'no'}`);
  console.log('--- last log ---');
  console.log(tailLog());
  if (running) process.exit(0);
  if (ok) process.exit(0);
  process.exit(1);
}

function run(cmd, cwd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
}

function runPack() {
  loadEnv();
  const { macNotarizeCliArg, printMacNotarizeSummary } = require('./mac-notarize-flag');
  printMacNotarizeSummary();
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN missing — cannot publish GitHub Release');
  }
  run('pnpm --filter @sideboard-ai/core build', repoRoot);
  run('pnpm --filter @sideboard-ai/cli build', repoRoot);
  run('pnpm exec electron-vite build', desktopRoot);
  run('node scripts/stage-bundled-node.js', desktopRoot);
  run('node scripts/stage-sideboard-mcp.js', desktopRoot);
  run('node scripts/stage-cursor-runtime.js', desktopRoot);
  const notarizeArg = macNotarizeCliArg();
  const builderCmd = ['pnpm exec electron-builder', '--mac', notarizeArg, '--publish always']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  run(builderCmd, desktopRoot);
  console.log('RELEASE_BUILD_OK');
}

function startDetached() {
  const existing = readPid();
  if (existing != null && isAlive(existing)) {
    console.log(`Already running pid=${existing}. Status only — not starting a second pack.`);
    printStatus();
    return;
  }
  if (logEndedOk()) {
    console.log('Log already has RELEASE_BUILD_OK. Not starting again.');
    printStatus();
    return;
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [__filename, '--run'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: repoRoot,
    env: process.env,
  });
  fs.closeSync(logFd);
  child.unref();
  fs.writeFileSync(pidPath, `${child.pid}\n`);
  console.log(`Detached Mac pack pid=${child.pid}`);
  console.log(`Log: ${logPath}`);
  console.log('End this turn. On "status?", run: node apps/desktop/scripts/release-mac-detached.js --status');
  console.log('Do not start another pack while this pid is alive.');
}

const arg = process.argv[2] || '';
if (arg === '--status' || arg === 'status') {
  printStatus();
} else if (arg === '--run') {
  runPack();
} else {
  startDetached();
}
