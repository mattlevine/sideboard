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
 *   node scripts/detached-job.js ui <id> [--title TEXT] [--out FILE]
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
  'Job is still running. present_artifact the ui HTML (same artifact_id as the job id) so the human sees work happening, then call wait again. Do not ask the user to check status, and do not start a second job with the same id.';

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
    ui: path.join(dir, 'ui.html'),
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readLogLines(file) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function inferPhase(lines) {
  const text = lines.join('\n');
  if (/RELEASE_BUILD_OK\b/.test(text)) return 'Published';
  const markers = [
    [/notarization successful/i, 'Notarized'],
    [/notariz/i, 'Notarizing'],
    [/\b(publishing|uploading|creating GitHub release)\b/i, 'Publishing'],
    [/\bsigning\b/i, 'Signing'],
    [/\b(building\s+target|packaging)\b/i, 'Packaging'],
    [/stage-/i, 'Staging'],
    [/electron-vite|✓ built in/i, 'Renderer'],
    [/tsup|@sideboard-ai\/(core|cli)/i, 'Building packages'],
  ];
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const [re, label] of markers) {
      if (re.test(lines[i])) return label;
    }
  }
  const lastCmd = [...lines].reverse().find((l) => l.startsWith('$ '));
  if (lastCmd) return lastCmd.slice(2).trim().slice(0, 72);
  const last = (lines[lines.length - 1] || '').trim();
  return last.slice(0, 72) || 'Running';
}

function isNoiseLine(line) {
  return (
    /\.(?:js|css|map|ttf|html)\s+[\d,.]+\s+kB\s*$/i.test(line) ||
    /^(ESM|CJS|DTS)\s+dist\/.+\s+[\d,.]+\s+(KB|B)$/i.test(line)
  );
}

function collectStream(logFile, maxLines = 160) {
  const all = readLogLines(logFile);
  const useful = all.filter((line) => !isNoiseLine(line));
  const source = useful.length > 0 && useful.length < all.length ? useful : all;
  const lines = source.slice(-maxLines);
  return {
    lineCount: all.length,
    lines,
    commands: all.filter((l) => l.startsWith('$ ')).map((l) => l.slice(2)),
    lastLine: (all[all.length - 1] || '').trim(),
    phase: inferPhase(all),
  };
}

function lineClass(line) {
  if (line.startsWith('$ ')) return 'cmd';
  if (/RELEASE_BUILD_OK|\b✓\b|notarization successful/i.test(line)) return 'ok';
  if (/\b(ERR_|error|failed|fatal)\b/i.test(line)) return 'err';
  return '';
}

function formatElapsed(startedAt) {
  if (!startedAt) return '';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function writeJobUi(snap, opts = {}) {
  const html = renderJobHtml(snap, opts);
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, html);
  }
  return html;
}

function renderJobHtml(snap, opts = {}) {
  const id = opts.id || 'job';
  const title = opts.title || id;
  const stream = snap.stream || collectStream(snap.log, opts.maxLines || 160);
  const status = snap.ok ? 'ok' : snap.failed ? 'failed' : snap.stillRunning || snap.running ? 'running' : 'idle';
  const statusLabel = status === 'ok' ? 'done' : status === 'running' ? 'working' : status;
  const rows = stream.lines.length ? stream.lines : ['(no log yet)'];
  const logHtml = rows
    .map((line, i) => {
      const cls = [lineClass(line), i === rows.length - 1 ? 'last' : ''].filter(Boolean).join(' ');
      const body = escapeHtml(line || ' ');
      return cls ? `<span class="${cls}">${body}</span>` : body;
    })
    .join('\n');
  const commands = stream.commands.slice(-8).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
  const elapsed = formatElapsed(snap.startedAt);
  const nowLine = stream.lastLine || stream.phase || '';
  const nowBlock =
    status === 'running'
      ? `<div class="now"><span class="dot"></span> ${escapeHtml(nowLine || 'Working…')}</div>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; background: #0f1115; color: #e8eaed; }
  header { padding: 14px 16px 12px; border-bottom: 1px solid #2a2f3a; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .pill { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px; }
  .pill.ok { background: #16351f; color: #6ee7a8; }
  .pill.running { background: #1d2a44; color: #93c5fd; animation: pulse 1.2s ease-in-out infinite; }
  .pill.failed { background: #3b1717; color: #fca5a5; }
  .pill.idle { background: #2a2f3a; color: #9aa3b2; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  .meta { color: #9aa3b2; font-size: 12px; }
  .phase { margin-top: 6px; color: #c4b5fd; font-size: 13px; }
  .now { margin-top: 8px; display: flex; align-items: center; gap: 8px; color: #e8eaed;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; animation: pulse 1.2s ease-in-out infinite; }
  .cmds { margin: 0; padding: 10px 16px 0 32px; color: #9aa3b2; font-size: 12px; }
  .cmds li { margin: 2px 0; }
  pre { margin: 0; padding: 14px 16px 24px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word; color: #d1d5db; height: calc(100vh - 120px); overflow: auto; }
  .cmd { color: #7dd3fc; }
  .ok { color: #6ee7a8; }
  .err { color: #fca5a5; }
  .last { background: #1a2333; box-shadow: inset 3px 0 0 #60a5fa; }
  .last::after { content: '${status === 'running' ? '▍' : ''}'; color: #93c5fd; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>${escapeHtml(title)}</h1>
    <span class="pill ${status}">${escapeHtml(statusLabel)}</span>
    <span class="meta">pid ${snap.pid ?? '—'} · ${stream.lineCount} lines${elapsed ? ` · ${elapsed}` : ''}</span>
  </div>
  <div class="phase">${escapeHtml(stream.phase || '')}</div>
  ${nowBlock}
</header>
${commands ? `<ol class="cmds">${commands}</ol>` : ''}
<pre id="log">${logHtml}</pre>
<script>const el=document.getElementById('log'); el.scrollTop=el.scrollHeight;</script>
</body>
</html>
`;
}

function logHasPattern(file, pattern) {
  if (!pattern || !fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').includes(pattern);
}

function snapshotFromPaths({ pidFile, logFile, exitFile, okPattern, startedAt, ui }) {
  const pid = readIntFile(pidFile);
  const running = pid != null && isAlive(pid);
  const exitCode = exitFile ? readIntFile(exitFile) : null;
  const okFromExit = exitCode === 0;
  const okFromPattern = okPattern ? logHasPattern(logFile, okPattern) && !running : false;
  const ok = !running && (okFromExit || okFromPattern);
  const failed = !running && !ok && (pid != null || (logFile && fs.existsSync(logFile)));
  const stream = collectStream(logFile, 160);
  return {
    pid,
    running,
    stillRunning: running,
    ok,
    failed,
    exitCode,
    log: logFile,
    ui,
    startedAt: startedAt || undefined,
    progress: tailFile(logFile, 12),
    phase: stream.phase,
    lineCount: stream.lineCount,
    stream,
  };
}

function readStartedAt(metaFile) {
  if (!metaFile || !fs.existsSync(metaFile)) return undefined;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return typeof meta.startedAt === 'string' ? meta.startedAt : undefined;
  } catch {
    return undefined;
  }
}

function snapshotJob(root, id) {
  const p = jobPaths(root, id);
  return snapshotFromPaths({
    pidFile: p.pid,
    logFile: p.log,
    exitFile: p.exit,
    startedAt: readStartedAt(p.meta),
    ui: p.ui,
  });
}

function printWaitResult(snap) {
  const payload = {
    stillRunning: Boolean(snap.stillRunning),
    ok: Boolean(snap.ok),
    failed: Boolean(snap.failed && !snap.stillRunning && !snap.ok),
    pid: snap.pid,
    exitCode: snap.exitCode ?? undefined,
    phase: snap.phase,
    lineCount: snap.lineCount,
    log: snap.log,
    ui: snap.ui,
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
  const snap = snapshotJob(root, id);
  writeJobUi(snap, { id, title: opts.title || id, out: p.ui });
  return {
    started: true,
    pid: child.pid,
    log: p.log,
    ui: p.ui,
    id,
    hint: 'present_artifact the ui HTML now (artifact_id = job id) so the human sees work happening. Then loop wait.',
  };
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
  const titleIdx = args.indexOf('--title');
  const outIdx = args.indexOf('--out');
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
    title: titleIdx >= 0 ? args[titleIdx + 1] : null,
    out: outIdx >= 0 ? args[outIdx + 1] : null,
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
    const result = startJob(root, parsed.id, parsed.command, { title: parsed.title });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.started || result.reason === 'already-running' ? 0 : 1);
  }
  if (parsed.cmd === 'status' || parsed.cmd === 'wait' || parsed.cmd === 'ui') {
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
    const uiOpts = {
      id: parsed.id || 'job',
      title: parsed.title || parsed.id || 'Detached job',
    };
    if (parsed.cmd === 'ui') {
      const snap = getSnap();
      const out = parsed.out || snap.ui;
      const html = writeJobUi(snap, { ...uiOpts, out });
      if (!parsed.out && !snap.ui) process.stdout.write(html);
      process.exit(0);
    }
    if (parsed.cmd === 'status') {
      const snap = getSnap();
      writeJobUi(snap, { ...uiOpts, out: parsed.out || snap.ui });
      const code = printWaitResult(snap);
      process.exit(code === 2 ? 0 : code);
    }
    const snap = await waitSnapshot(getSnap, parsed.timeoutMs);
    writeJobUi(snap, { ...uiOpts, out: parsed.out || snap.ui });
    process.exit(printWaitResult(snap));
  }
  console.error(`Usage:
  node scripts/detached-job.js start <id> -- <command>...
  node scripts/detached-job.js wait <id>
  node scripts/detached-job.js wait <id> --until-done
  node scripts/detached-job.js status <id>
  node scripts/detached-job.js ui <id> [--title TEXT] [--out FILE]`);
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
  collectStream,
  inferPhase,
  escapeHtml,
  renderJobHtml,
  writeJobUi,
  formatElapsed,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
