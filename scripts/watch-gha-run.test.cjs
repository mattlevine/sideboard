'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  HEARTBEAT_EVERY,
  formatRunSnapshot,
  snapshotKey,
  main,
} = require('./watch-gha-run.cjs');

function sampleRun(overrides = {}) {
  return {
    displayTitle: 'v0.1.271 Release',
    status: 'in_progress',
    conclusion: '',
    url: 'https://github.com/mattlevine/sideboard/actions/runs/1',
    jobs: [
      {
        name: 'release-desktop-mac',
        status: 'in_progress',
        conclusion: '',
        steps: [{ name: 'Build & publish Electron (signed)', status: 'in_progress' }],
      },
      {
        name: 'release-cli',
        status: 'completed',
        conclusion: 'success',
        steps: [{ name: 'Complete job', status: 'completed', conclusion: 'success' }],
      },
    ],
    ...overrides,
  };
}

describe('watch-gha-run', () => {
  it('formats a compact snapshot with the active step', () => {
    const out = formatRunSnapshot(sampleRun(), 'watch');
    assert.match(out, /watch v0\.1\.271 Release · in_progress/);
    assert.match(out, /release-desktop-mac in_progress — Build & publish Electron \(signed\)/);
    assert.match(out, /release-cli completed success/);
    assert.doesNotMatch(out, /Refreshing run status/);
  });

  it('changes snapshot key when the in-progress step changes', () => {
    const first = snapshotKey(sampleRun());
    const second = snapshotKey(
      sampleRun({
        jobs: [
          {
            name: 'release-desktop-mac',
            status: 'in_progress',
            steps: [{ name: 'Import Developer ID certificate', status: 'in_progress' }],
          },
        ],
      }),
    );
    assert.notEqual(first, second);
  });

  it('prints once, heartbeats while unchanged, then exits on success', async () => {
    const lines = [];
    let n = 0;
    const run = sampleRun();
    const code = await main(['37530541455'], {
      fetchRun: () => {
        n += 1;
        if (n > HEARTBEAT_EVERY + 1) {
          return { ...run, status: 'completed', conclusion: 'success' };
        }
        return run;
      },
      sleep: async () => {},
      log: (line) => lines.push(line),
    });
    assert.equal(code, 0);
    assert.equal(lines.filter((l) => l.startsWith('watch ')).length, 1);
    assert.equal(lines.filter((l) => l.startsWith('still ')).length, 1);
    assert.match(lines.at(-1), /update .*completed success/);
  });

  it('exits 1 when the run fails', async () => {
    const code = await main(['9'], {
      fetchRun: () => ({
        displayTitle: 'Release',
        status: 'completed',
        conclusion: 'failure',
        jobs: [],
      }),
      sleep: async () => {},
      log: () => {},
    });
    assert.equal(code, 1);
  });
});
