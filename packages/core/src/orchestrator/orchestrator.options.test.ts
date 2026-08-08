import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.setThreadOptions agent switch', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-opts-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread(messages: { role: 'user' | 'agent'; text: string; ts: string }[] = []) {
    const thread = createEmptyThread({
      title: 'Test',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/test',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      model: 'sonnet',
      status: 'idle',
    });
    thread.messages = messages;
    writeThread(thread);
    return thread;
  }

  it('allows switching agent on an empty chat', () => {
    const thread = seedThread();
    const orch = new Orchestrator();
    const next = orch.setThreadOptions(thread.id, { agent: 'cursor' });
    expect(next.agent).toBe('cursor');
    expect(next.model).toBeNull();
    expect(next.sessionId).toBeNull();
    expect(readThread(thread.id)?.agent).toBe('cursor');
  });

  it('allows same-provider model changes mid-chat', () => {
    const thread = seedThread([
      { role: 'user', text: 'hi', ts: '2026-08-08T00:00:00.000Z' },
    ]);
    const orch = new Orchestrator();
    const next = orch.setThreadOptions(thread.id, { agent: 'claude', model: 'opus' });
    expect(next.agent).toBe('claude');
    expect(next.model).toBe('opus');
  });

  it('rejects switching agent provider mid-chat', () => {
    const thread = seedThread([
      { role: 'user', text: 'hi', ts: '2026-08-08T00:00:00.000Z' },
    ]);
    const orch = new Orchestrator();
    expect(() => orch.setThreadOptions(thread.id, { agent: 'cursor' })).toThrow(
      /Cannot switch agent provider mid-chat/,
    );
    expect(readThread(thread.id)?.agent).toBe('claude');
  });
});
