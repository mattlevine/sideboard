#!/usr/bin/env node
/**
 * Detach any long-running command so a Sideboard / Cursor worktree turn
 * SIGTERM does not kill it. Wait in 45s slices (same idea as wait_for_turn)
 * so the agent loops until done — do not ask the human to poll.
 *
 *   node scripts/detached-job.js start <id> -- <command> [args...]
 *   node scripts/detached-job.js wait <id>
 *   node scripts/detached-job.js wait <id> --until-done
 *   node scripts/detached-job.js status <id>
 *   node scripts/detached-job.js wait --pid-file FILE --log-file FILE [--ok-pattern TEXT]
 *
 * Job state: .sideboard/detached-jobs/<id>/ (gitignored).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WAIT_SLICE_MS = 45_000;
const WAIT_POLL_MS = 2_000;
const WAIT_UNTIL_DONE_MS = 90 * 60 * 1000;
const WAIT_STILL_RUNNING_HINT =
  'Job is still running. Call wait again. Do not ask the user to check status, and do not start a second job with the same id.';

function repoRootFrom(cwd = process.cwd()) {
  return cwd;
}

function jobsRoot(root) {
  return path.join(root, '.sideboard', 'detached-jobs');
}

function sanitizeId(id) {
  const s = String(id ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(s)) {
    throw new Error(`detached-job id must be 1–64 chars [A-Za-z0-9._-], got ${JSON.stringify(id)}`);
  }
  return s;
}

function jobPaths(root, id) {
  const dir = path.join(jobsRoot(root), sanitizeId(id));
  return {
    dir,
    pid: path.join(dir, 'pid'),
    log: path.join(dir, 'log'),
    exit: path.join(dir, 'exit'),
    meta: path.join(dir, 'meta.json'),
  };
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

function readIntFile(file) {
  if (!fs.existsSync(file)) return null;
  const n = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
  return Number.isInteger(n) ? n : null;
}

function tailFile(file, maxLines = 12) {
  if (!fs.existsSync(file)) return '(no log yet)';
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  return lines.slice(-maxLines).join('\n');
}

function logHasPattern(file, pattern) {
  if (!pattern || !fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').includes(pattern);
}

function snapshotFromPaths({ pidFile, logFile, exitFile, okPattern }) {
  const pid = readIntFile(pidFile);
  const running = pid != null && isAlive(pid);
  const exitCode = exitFile ? readIntFile(exitFile) : null;
  const okFromExit = exitCode === 0;
  const okFromPattern = okPattern ? logHasPattern(logFile, okPattern) && !running : false;
  const ok = !running && (okFromExit || okFromPattern);
  const failed = !running && !ok && (pid != null || (logFile && fs.existsSync(logFile)));
  return {
    pid,
    running,
    stillRunning: running,
    ok,
    failed,
    exitCode,
    log: logFile,
    progress: tailFile(logFile, 12),
  };
}

function snapshotJob(root, id) {
  const p = jobPaths(root, id);
  return snapshotFromPaths({
    pidFile: p.pid,
    logFile: p.log,
    exitFile: p.exit,
  });
}

function printWaitResult(snap) {
  const payload = {
    stillRunning: Boolean(snap.stillRunning),
    ok: Boolean(snap.ok),
    failed: Boolean(snap.failed && !snap.stillRunning && !snap.ok),
    pid: snap.pid,
    exitCode: snap.exitCode ?? undefined,
    log: snap.log,
    progress: snap.progress,
    hint: snap.stillRunning ? WAIT_STILL_RUNNING_HINT : undefined,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (snap.ok && !snap.running) return 0;
  if (snap.stillRunning) return 2;
  return 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitSnapshot(getSnap, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let snap = getSnap();
  if (snap.ok && !snap.running) return snap;
  if (!snap.running && !snap.ok && snap.pid == null && !snap.progress?.includes('\n') && snap.progress === '(no log yet)') {
    return {
      ...snap,
      failed: true,
      stillRunning: false,
      progress: 'No detached job. Start one first.',
    };
  }
  while (Date.now() < deadline) {
    snap = getSnap();
    if (snap.ok && !snap.running) return snap;
    if (!snap.running && !snap.ok) return { ...snap, failed: true, stillRunning: false };
    await sleep(WAIT_POLL_MS);
  }
  snap = getSnap();
  return { ...snap, stillRunning: snap.running || !snap.ok };
}

function startJob(root, id, command, opts = {}) {
  const p = jobPaths(root, id);
  const existing = snapshotJob(root, id);
  if (existing.running) {
    return { started: false, reason: 'already-running', snapshot: existing };
  }
  fs.mkdirSync(p.dir, { recursive: true });
  try {
    fs.unlinkSync(p.exit);
  } catch {
    /* ok */
  }
  const logFd = fs.openSync(p.log, 'a');
  const cwd = opts.cwd || root;
  const child = spawn(process.execPath, [__filename, '--wrap', p.dir, cwd, ...command], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd,
    env: process.env,
  });
  fs.closeSync(logFd);
  child.unref();
  fs.writeFileSync(p.pid, `${child.pid}\n`);
  fs.writeFileSync(
    p.meta,
    `${JSON.stringify({ id, command, cwd, startedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return { started: true, pid: child.pid, log: p.log, id };
}

function runWrap(jobDir, cwd, command) {
  const logFd = fs.openSync(path.join(jobDir, 'log'), 'a');
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
  });
  const writeExit = (code) => {
    try {
      fs.writeFileSync(path.join(jobDir, 'exit'), `${code ?? 1}\n`);
    } catch {
      /* ignore */
    }
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  };
  child.on('exit', (code, signal) => {
    writeExit(signal ? 1 : code ?? 1);
    process.exit(signal ? 1 : code ?? 1);
  });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const untilDone = args.includes('--until-done');
  let timeoutMs = untilDone ? WAIT_UNTIL_DONE_MS : WAIT_SLICE_MS;
  const timeoutIdx = args.indexOf('--timeout-ms');
  if (timeoutIdx >= 0 && args[timeoutIdx + 1]) {
    const n = Number.parseInt(args[timeoutIdx + 1], 10);
    if (Number.isFinite(n) && n >= 1000) timeoutMs = n;
  }
  const pidIdx = args.indexOf('--pid-file');
  const logIdx = args.indexOf('--log-file');
  const okIdx = args.indexOf('--ok-pattern');
  const dash = args.indexOf('--');
  const cmd = args[0];
  const id = args[1] && !args[1].startsWith('-') ? args[1] : null;
  return {
    cmd,
    id,
    untilDone,
    timeoutMs,
    pidFile: pidIdx >= 0 ? args[pidIdx + 1] : null,
    logFile: logIdx >= 0 ? args[logIdx + 1] : null,
    okPattern: okIdx >= 0 ? args[okIdx + 1] : null,
    command: dash >= 0 ? args.slice(dash + 1) : [],
  };
}

async function main(argv = process.argv) {
  const root = repoRootFrom(process.cwd());
  if (argv[2] === '--wrap') {
    const jobDir = argv[3];
    const cwd = argv[4];
    const command = argv.slice(5);
    runWrap(jobDir, cwd, command);
    return;
  }
  const parsed = parseArgs(argv);
  if (parsed.cmd === 'start') {
    if (!parsed.id || parsed.command.length === 0) {
      console.error('Usage: node scripts/detached-job.js start <id> -- <command>...');
      process.exit(1);
    }
    const result = startJob(root, parsed.id, parsed.command);
    console.log(JSON.stringify({ ...result, hint: 'Call wait next. Loop while stillRunning. Do not ask the user to poll.' }, null, 2));
    process.exit(result.started || result.reason === 'already-running' ? 0 : 1);
  }
  if (parsed.cmd === 'status' || parsed.cmd === 'wait') {
    let getSnap;
    if (parsed.pidFile && parsed.logFile) {
      getSnap = () =>
        snapshotFromPaths({
          pidFile: path.resolve(parsed.pidFile),
          logFile: path.resolve(parsed.logFile),
          okPattern: parsed.okPattern,
        });
    } else if (parsed.id) {
      getSnap = () => snapshotJob(root, parsed.id);
    } else {
      console.error('Usage: node scripts/detached-job.js wait <id>  OR  --pid-file FILE --log-file FILE');
      process.exit(1);
    }
    if (parsed.cmd === 'status') {
      const code = printWaitResult(getSnap());
      process.exit(code === 2 ? 0 : code);
    }
    const snap = await waitSnapshot(getSnap, parsed.timeoutMs);
    process.exit(printWaitResult(snap));
  }
  console.error(`Usage:
  node scripts/detached-job.js start <id> -- <command>...
  node scripts/detached-job.js wait <id>
  node scripts/detached-job.js wait <id> --until-done
  node scripts/detached-job.js status <id>`);
  process.exit(1);
}

module.exports = {
  WAIT_SLICE_MS,
  WAIT_STILL_RUNNING_HINT,
  sanitizeId,
  jobPaths,
  isAlive,
  snapshotFromPaths,
  snapshotJob,
  startJob,
  waitSnapshot,
  parseArgs,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
