import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.getTurnResult', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-turn-result-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(opts: {
    status: 'idle' | 'error';
    lastError?: string | null;
    agentText?: string;
  }) {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Review',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/review',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      status: opts.status,
    });
    thread.lastError = opts.lastError ?? null;
    if (opts.agentText) {
      thread.messages.push({
        role: 'agent',
        text: opts.agentText,
        ts: new Date().toISOString(),
      });
    }
    writeThread(thread);
    return thread;
  }

  it('fills text from lastError when the turn failed with no agent message', () => {
    const thread = seed({
      status: 'error',
      lastError:
        'Cursor runner crashed in Node (Homebrew Node + shared libuv). Install Node 22 LTS (`brew install node@22`) and retry.',
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.status).toBe('error');
    expect(result.lastError).toMatch(/shared libuv/);
    expect(result.text).toBe(result.lastError);
  });

  it('keeps assistant text when present and still returns lastError', () => {
    const thread = seed({
      status: 'error',
      lastError: 'exit 1: boom',
      agentText: 'partial review',
    });
    const result = new Orchestrator().getTurnResult(thread.id);
    expect(result.text).toBe('partial review');
    expect(result.lastError).toBe('exit 1: boom');
  });
});
