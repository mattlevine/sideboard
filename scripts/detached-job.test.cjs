'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeId,
  jobsRoot,
  jobPaths,
  jobPathsAt,
  resolveJobKind,
  startJob,
  snapshotFromPaths,
  waitSnapshot,
  inferPhase,
  escapeHtml,
  renderJobHtml,
  takeDelta,
} = require('./detached-job.js');

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
    fs.writeFileSync(pidFile, '1\n');
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
    fs.writeFileSync(pidFile, '1\n');
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
    fs.writeFileSync(pidFile, '1\n');
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
    fs.writeFileSync(pidFile, '1\n');
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
