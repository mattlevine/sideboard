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
 *   node apps/desktop/scripts/release-mac-detached.js --wait
 *   node apps/desktop/scripts/release-mac-detached.js --wait --until-done
 *   node apps/desktop/scripts/release-mac-detached.js --status
 *
 * Log/pid live under apps/desktop/release/ (gitignored).
 */

'use strict';

const WAIT_SLICE_MS = 45_000;
const WAIT_UNTIL_DONE_MS = 90 * 60 * 1000;

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

function snapshot() {
  const pid = readPid();
  const running = pid != null && isAlive(pid);
  const ok = logEndedOk();
  const failed = !running && !ok && (pid != null || fs.existsSync(logPath));
  return {
    pid,
    running,
    ok,
    failed,
    stillRunning: running,
    progress: tailLog(12),
    log: logPath,
  };
}

function printStatus() {
  const snap = snapshot();
  console.log(`pid: ${snap.pid ?? '(none)'} ${snap.running ? '(running)' : '(not running)'}`);
  console.log(`log: ${snap.log}`);
  console.log(`ok: ${snap.ok ? 'yes' : 'no'}`);
  console.log('--- last log ---');
  console.log(snap.progress);
  if (snap.running || snap.ok) process.exit(0);
  process.exit(1);
}

async function waitForPack(timeoutMs) {
  const detached = require(path.join(repoRoot, 'scripts/detached-job.js'));
  const snap = await detached.waitSnapshot(
    () =>
      detached.snapshotFromPaths({
        pidFile: pidPath,
        logFile: logPath,
        okPattern: 'RELEASE_BUILD_OK',
      }),
    timeoutMs,
  );
  const payload = {
    stillRunning: Boolean(snap.stillRunning),
    ok: Boolean(snap.ok),
    failed: Boolean(snap.failed && !snap.stillRunning && !snap.ok),
    pid: snap.pid,
    log: snap.log,
    progress: snap.progress,
    hint: snap.stillRunning ? detached.WAIT_STILL_RUNNING_HINT : undefined,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (snap.ok && !snap.running) process.exit(0);
  if (snap.stillRunning) process.exit(2);
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
  console.log('Call --wait next (loop while stillRunning). Do not ask the user to poll.');
  console.log('Do not start another pack while this pid is alive.');
}

const args = process.argv.slice(2);
const argSet = new Set(args);
if (argSet.has('--status') || argSet.has('status')) {
  printStatus();
} else if (argSet.has('--run')) {
  runPack();
} else if (argSet.has('--wait') || argSet.has('wait')) {
  const untilDone = argSet.has('--until-done') || argSet.has('until-done');
  let timeoutMs = untilDone ? WAIT_UNTIL_DONE_MS : WAIT_SLICE_MS;
  const timeoutIdx = args.findIndex((a) => a === '--timeout-ms');
  if (timeoutIdx >= 0 && args[timeoutIdx + 1]) {
    const n = Number.parseInt(args[timeoutIdx + 1], 10);
    if (Number.isFinite(n) && n >= 1000) timeoutMs = n;
  }
  waitForPack(timeoutMs).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  startDetached();
}
