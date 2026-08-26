'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeId,
  snapshotFromPaths,
  waitSnapshot,
} = require('./detached-job.js');

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
