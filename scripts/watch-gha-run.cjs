#!/usr/bin/env node
/**
 * Poll a GitHub Actions run without `gh run watch`.
 *
 * `gh run watch` reprints the full TTY checklist every 3 seconds. A detached
 * job that captures that stream writes tens of thousands of identical frames
 * and can stall the Sideboard log pane (v0.1.271).
 *
 *   node scripts/watch-gha-run.cjs <run-id>
 *
 * Prints a compact snapshot when status/steps change, plus a heartbeat after
 * 5 quiet minutes. Exits 0 on success, 1 on failure/cancel.
 */
'use strict';

const { execFileSync } = require('node:child_process');

const INTERVAL_MS = 20_000;
const HEARTBEAT_EVERY = 15;

function activeStepName(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const active = steps.find((s) => s && s.status === 'in_progress');
  return typeof active?.name === 'string' ? active.name : '';
}

function jobKey(job) {
  return [job?.name, job?.status, job?.conclusion || '', activeStepName(job)].join(':');
}

function snapshotKey(run) {
  const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
  return JSON.stringify({
    status: run?.status || '',
    conclusion: run?.conclusion || '',
    jobs: jobs.map(jobKey),
  });
}

function formatRunSnapshot(run, reason) {
  const title = String(run?.displayTitle || '').replace(/\s+/g, ' ').trim();
  const status = run?.status || 'unknown';
  const conclusion = run?.conclusion ? ` ${run.conclusion}` : '';
  const lines = [`${reason} ${title} · ${status}${conclusion}`.trim()];
  for (const job of run?.jobs || []) {
    const step = activeStepName(job);
    const jobConclusion = job?.conclusion ? ` ${job.conclusion}` : '';
    const suffix = step ? ` — ${step}` : '';
    lines.push(`  ${job?.name || 'job'} ${job?.status || '?'}${jobConclusion}${suffix}`);
  }
  if (run?.url) lines.push(run.url);
  return lines.join('\n');
}

function fetchRun(runId) {
  const raw = execFileSync(
    'gh',
    ['run', 'view', String(runId), '--json', 'status,conclusion,displayTitle,url,jobs'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(argv = process.argv.slice(2), opts = {}) {
  const runId = argv[0];
  if (!runId || runId === '-h' || runId === '--help') {
    console.error('Usage: node scripts/watch-gha-run.cjs <run-id>');
    return 2;
  }
  const view = opts.fetchRun || fetchRun;
  const wait = opts.sleep || sleep;
  const log = opts.log || console.log;
  let lastKey = '';
  let quiet = 0;
  for (;;) {
    const run = view(runId);
    const key = snapshotKey(run);
    if (key !== lastKey) {
      log(formatRunSnapshot(run, lastKey ? 'update' : 'watch'));
      lastKey = key;
      quiet = 0;
    } else {
      quiet += 1;
      if (quiet % HEARTBEAT_EVERY === 0) {
        log(`still ${run.status || 'unknown'} (${quiet * (INTERVAL_MS / 1000)}s unchanged)`);
      }
    }
    if (run.status === 'completed') {
      return run.conclusion === 'success' ? 0 : 1;
    }
    await wait(INTERVAL_MS);
  }
}

module.exports = {
  INTERVAL_MS,
  HEARTBEAT_EVERY,
  activeStepName,
  snapshotKey,
  formatRunSnapshot,
  main,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
