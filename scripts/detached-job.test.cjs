'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  sanitizeId,
  jobsRoot,
  jobPaths,
  jobPathsAt,
  resolveJobKind,
  startJob,
  stopJob,
  formatStopPayload,
  jobTreeAlive,
  snapshotFromPaths,
  snapshotJob,
  waitSnapshot,
  inferPhase,
  escapeHtml,
  renderJobHtml,
  takeDelta,
  WAIT_STILL_RUNNING_HINT,
} = require('./detached-job.cjs');

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(pred, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timed out after ${ms}ms`);
}

async function startStubbornChildJob(root, id) {
  const p = jobPaths(root, id);
  fs.mkdirSync(p.dir, { recursive: true });
  const childPidFile = path.join(p.dir, 'child.pid');
  const stubborn = `
    process.on('SIGTERM', () => {});
    require('fs').writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `;
  const wrapCode = `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(stubborn)}], { stdio: 'ignore' });
    child.unref();
    setInterval(() => {}, 1000);
  `;
  const wrap = spawn(process.execPath, ['-e', wrapCode], {
    detached: true,
    stdio: 'ignore',
  });
  wrap.unref();
  const wrapPid = wrap.pid;
  if (!wrapPid) throw new Error('wrap pid missing');
  fs.writeFileSync(p.pid, `${wrapPid}\n`);
  fs.writeFileSync(p.log, 'waiting\n');
  await waitUntil(() => fs.existsSync(childPidFile), 3_000);
  const childPid = Number.parseInt(fs.readFileSync(childPidFile, 'utf8').trim(), 10);
  if (!Number.isInteger(childPid) || childPid <= 0) throw new Error('child pid missing');
  return {
    id,
    wrapPid,
    childPid,
    cleanup: () => {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      try {
        process.kill(-wrapPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      try {
        process.kill(wrapPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    },
  };
}

describe('jobPaths', () => {
  it('writes new jobs under .context/.sideboard/detached-jobs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-root-'));
    assert.equal(
      jobsRoot(root),
      path.join(root, '.context', '.sideboard', 'detached-jobs'),
    );
    const p = jobPaths(root, 'gha-release');
    assert.equal(
      p.dir,
      path.join(root, '.context', '.sideboard', 'detached-jobs', 'gha-release'),
    );
    assert.equal(resolveJobKind(root, 'gha-release'), 'modern');
  });

  it('wait/status find a legacy .sideboard/detached-jobs job', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-legacy-'));
    const legacy = jobPathsAt(root, 'gha-release', 'legacy');
    fs.mkdirSync(legacy.dir, { recursive: true });
    fs.writeFileSync(legacy.log, 'old\n');
    assert.equal(resolveJobKind(root, 'gha-release'), 'legacy');
    assert.equal(jobPaths(root, 'gha-release').dir, legacy.dir);
  });

  it('startJob writes a gitignore under .context/.sideboard', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-start-'));
    const result = startJob(root, 'core-test', ['true']);
    assert.equal(result.started, true);
    assert.ok(result.log.includes(`${path.sep}.context${path.sep}.sideboard${path.sep}detached-jobs${path.sep}`));
    const gi = path.join(root, '.context', '.sideboard', '.gitignore');
    assert.equal(fs.existsSync(gi), true);
    assert.match(fs.readFileSync(gi, 'utf8'), /\*/);
  });

  it('runs as CJS next to a type:module package.json (packaged MCP layout)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-esm-pkg-'));
    const dest = path.join(root, 'sideboard-mcp');
    const cjs = path.join(dest, 'scripts', 'detached-job.cjs');
    const js = path.join(dest, 'scripts', 'detached-job.js');
    fs.mkdirSync(path.dirname(cjs), { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'package.json'),
      `${JSON.stringify({ name: 'sideboard-mcp', private: true, type: 'module' }, null, 2)}\n`,
    );
    fs.copyFileSync(path.join(__dirname, 'detached-job.cjs'), cjs);
    fs.copyFileSync(path.join(__dirname, 'detached-job.cjs'), js);
    const asCjs = spawnSync(process.execPath, [cjs, 'status', 'gone'], {
      encoding: 'utf8',
      cwd: root,
    });
    assert.doesNotMatch(asCjs.stderr, /require is not defined/);
    assert.match(asCjs.stdout, /stillRunning/);
    assert.match(asCjs.stdout, /"id": "gone"/);
    const asJs = spawnSync(process.execPath, [js, 'status', 'gone'], {
      encoding: 'utf8',
      cwd: root,
    });
    assert.match(asJs.stderr, /require is not defined/);
  });
});

describe('stopJob', () => {
  it('kills a running sleep and writes an exit file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-stop-'));
    const started = startJob(root, 'hang', ['sleep', '60']);
    assert.equal(started.started, true);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && !snapshotJob(root, 'hang').running) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(snapshotJob(root, 'hang').running, true);
    const result = await stopJob(root, 'hang', { reason: 'no progress', graceMs: 800 });
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'stopped');
    const after = snapshotJob(root, 'hang');
    assert.equal(after.running, false);
    assert.match(fs.readFileSync(after.log, 'utf8'), /\$ stop: no progress/);
    assert.equal(fs.existsSync(path.join(path.dirname(after.log), 'exit')), true);
  });

  it('is a no-op when the id has no running job', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-stop-miss-'));
    const missing = await stopJob(root, 'gone');
    assert.equal(missing.stopped, false);
    assert.equal(missing.reason, 'not-found');
  });

  it('SIGKILLs leftover children after wrap exits on SIGTERM', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-stop-wrap-'));
    const { id, wrapPid, childPid, cleanup } = await startStubbornChildJob(root, 'hang');
    try {
      assert.equal(jobTreeAlive(wrapPid), true);
      const result = await stopJob(root, id, { graceMs: 400 });
      assert.equal(result.stopped, true);
      assert.equal(result.reason, 'stopped');
      assert.equal(result.snapshot.stillRunning, false);
      assert.match(result.hint, /Stopped/);
      assert.equal(jobTreeAlive(wrapPid), false);
      assert.equal(pidAlive(childPid), false);
    } finally {
      cleanup();
    }
  });

  it('still SIGKILLs the group when wrap is already dead', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-stop-dead-wrap-'));
    const { id, wrapPid, childPid, cleanup } = await startStubbornChildJob(root, 'hang');
    try {
      process.kill(wrapPid, 'SIGKILL');
      await waitUntil(() => !pidAlive(wrapPid), 2_000);
      assert.equal(pidAlive(childPid), true);
      assert.equal(jobTreeAlive(wrapPid), true);
      const result = await stopJob(root, id, { graceMs: 400 });
      assert.equal(result.stopped, true);
      assert.equal(result.reason, 'stopped');
      assert.equal(pidAlive(childPid), false);
    } finally {
      cleanup();
    }
  });
});

describe('formatStopPayload', () => {
  it('prints the stopped hint only when the job is gone', () => {
    const stopped = formatStopPayload({
      stopped: true,
      reason: 'stopped',
      id: 'hang',
      snapshot: { running: false, stillRunning: false, pid: 9, exitCode: 1 },
    });
    assert.equal(stopped.status, 'failed');
    assert.equal(stopped.stillRunning, false);
    assert.equal(stopped.ok, false);
    assert.equal(stopped.failed, true);
    assert.match(stopped.hint, /Stopped/);
  });

  it('reports running after a failed kill — never idle or ok', () => {
    const failed = formatStopPayload({
      stopped: false,
      reason: 'still-running',
      id: 'hang',
      hint: 'Stopped. present_artifact type=log with status=failed and the last delta. Do not wait again unless you start a new command.',
      snapshot: { running: true, stillRunning: true, ok: true, pid: 9 },
    });
    assert.equal(failed.status, 'running');
    assert.equal(failed.stillRunning, true);
    assert.equal(failed.ok, false);
    assert.equal(failed.failed, true);
    assert.equal(failed.stopped, false);
    assert.equal(failed.hint, WAIT_STILL_RUNNING_HINT);
    assert.doesNotMatch(failed.hint, /^Stopped/);
  });

  it('keeps not-found / not-running distinct from a successful stop', () => {
    const missing = formatStopPayload({
      stopped: false,
      reason: 'not-found',
      id: 'gone',
      hint: 'No detached job with that id. Start one first, or pick the id from wait/status.',
    });
    assert.equal(missing.status, 'failed');
    assert.equal(missing.stillRunning, false);
    assert.doesNotMatch(missing.hint, /^Stopped/);

    const finished = formatStopPayload({
      stopped: false,
      reason: 'not-running',
      id: 'done',
      hint: 'That job is already finished. Read the log; do not wait again unless you start a new command.',
      snapshot: { ok: true, failed: false, running: false, pid: 1, exitCode: 0 },
    });
    assert.equal(finished.status, 'ok');
    assert.equal(finished.ok, true);
    assert.equal(finished.failed, false);
    assert.doesNotMatch(finished.hint, /^Stopped/);
  });
});

describe('sanitizeId', () => {
  it('accepts kebab ids', () => {
    assert.equal(sanitizeId('mac-release'), 'mac-release');
  });
  it('rejects path traversal', () => {
    assert.throws(() => sanitizeId('../etc'));
  });
});

describe('snapshotFromPaths', () => {
  it('is ok when exit code is 0 and pid is dead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-'));
    const pidFile = path.join(dir, 'pid');
    const logFile = path.join(dir, 'log');
    const exitFile = path.join(dir, 'exit');
    fs.writeFileSync(pidFile, '999999999\n');
    fs.writeFileSync(exitFile, '0\n');
    fs.writeFileSync(logFile, 'done\n');
    const snap = snapshotFromPaths({ pidFile, logFile, exitFile });
    assert.equal(snap.running, false);
    assert.equal(snap.ok, true);
    assert.equal(snap.failed, false);
  });

  it('is ok when ok-pattern is in the log and pid is dead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-'));
    const pidFile = path.join(dir, 'pid');
    const logFile = path.join(dir, 'log');
    fs.writeFileSync(pidFile, '999999999\n');
    fs.writeFileSync(logFile, 'RELEASE_BUILD_OK\n');
    const snap = snapshotFromPaths({
      pidFile,
      logFile,
      okPattern: 'RELEASE_BUILD_OK',
    });
    assert.equal(snap.ok, true);
    assert.equal(snap.stillRunning, false);
  });

  it('waitSnapshot returns immediately when already ok', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-'));
    const pidFile = path.join(dir, 'pid');
    const logFile = path.join(dir, 'log');
    const exitFile = path.join(dir, 'exit');
    fs.writeFileSync(pidFile, '999999999\n');
    fs.writeFileSync(exitFile, '0\n');
    fs.writeFileSync(logFile, 'ok\n');
    const snap = await waitSnapshot(
      () => snapshotFromPaths({ pidFile, logFile, exitFile }),
      5_000,
    );
    assert.equal(snap.ok, true);
    assert.equal(snap.stillRunning, false);
  });
});

describe('stream ui', () => {
  it('escapes html in the log', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('infers phase from the newest marker', () => {
    assert.equal(inferPhase(['$ build', '  • signing']), 'Signing');
    assert.equal(inferPhase(['  • signing', 'RELEASE_BUILD_OK']), 'Published');
  });

  it('drops vite asset-size noise from the stream', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-'));
    const pidFile = path.join(dir, 'pid');
    const logFile = path.join(dir, 'log');
    fs.writeFileSync(pidFile, '999999999\n');
    fs.writeFileSync(
      logFile,
      [
        '$ pnpm exec electron-vite build',
        '../../out/renderer/assets/index-qD1B-zen.js                         11,013.23 kB',
        'ESM dist/index.js                       217.30 KB',
        '✓ built in 19.20s',
        '$ pnpm exec electron-builder --mac',
        '  • notarization successful',
        'RELEASE_BUILD_OK',
        '',
      ].join('\n'),
    );
    const snap = snapshotFromPaths({ pidFile, logFile, okPattern: 'RELEASE_BUILD_OK' });
    assert.equal(snap.phase, 'Published');
    assert.equal(snap.stream.lines.some((l) => l.includes('11,013.23 kB')), false);
    assert.equal(snap.stream.lines.some((l) => l.includes('notarization successful')), true);
  });

  it('renders a panel with collected lines', () => {
    const html = renderJobHtml(
      {
        ok: true,
        failed: false,
        running: false,
        stillRunning: false,
        pid: 9,
        log: '/tmp/log',
        stream: {
          lineCount: 2,
          lines: ['$ echo <hi>', 'RELEASE_BUILD_OK'],
          commands: ['echo <hi>'],
          lastLine: 'RELEASE_BUILD_OK',
          phase: 'Published',
        },
      },
      { id: 'mac-release', title: 'Mac pack' },
    );
    assert.match(html, /Mac pack/);
    assert.match(html, /class="pill ok"/);
    assert.match(html, /Published/);
    assert.match(html, /&lt;hi&gt;/);
    assert.doesNotMatch(html, /<hi>/);
  });

  it('takeDelta returns only lines after the cursor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-job-'));
    const cursorFile = path.join(dir, 'cursor');
    fs.writeFileSync(cursorFile, '1\n');
    const first = takeDelta(['a', 'b', 'c'], cursorFile);
    assert.equal(first.delta, 'b\nc');
    assert.equal(first.nextCursor, 3);
    const again = takeDelta(['a', 'b', 'c'], cursorFile);
    assert.equal(again.delta, 'b\nc');
  });

  it('marks a running job as working with the latest line', () => {
    const html = renderJobHtml(
      {
        ok: false,
        failed: false,
        running: true,
        stillRunning: true,
        pid: 42,
        startedAt: new Date().toISOString(),
        stream: {
          lineCount: 1,
          lines: ['Signing Sideboard.app'],
          commands: [],
          lastLine: 'Signing Sideboard.app',
          phase: 'Signing',
        },
      },
      { id: 'mac-release', title: 'Mac pack' },
    );
    assert.match(html, /class="pill running"/);
    assert.match(html, />working</);
    assert.match(html, /Signing Sideboard\.app/);
    assert.match(html, /class="dot"/);
  });
});
