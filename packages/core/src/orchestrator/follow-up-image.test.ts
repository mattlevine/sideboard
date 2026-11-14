import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';
import type { ThreadAttachment } from '../types/thread.js';

const shot = (id: string, preview: string): ThreadAttachment => ({
  id,
  name: 'shot.png',
  kind: 'file',
  content: 'Image attached: shot.png',
  previewDataUrl: preview,
});

describe('follow-up images while the agent has not replied', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-follow-up-image-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(queue: string[]) {
    const thread = createEmptyThread({
      title: 'Test',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/test',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      queue,
      status: 'running',
    });
    writeThread(thread);
    return thread;
  }

  it('keeps the image on the prompt before the process starts', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seed([]);
    const img = shot('img-1', 'data:image/png;base64,xx');
    const live = readThread(thread.id)!;
    live.messages = [{ role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' }];
    live.attachments = [img];
    writeThread(live);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      startingTurns: Set<string>;
      openSteerPrompt: Map<string, { text: string; spawned: boolean; attachments?: ThreadAttachment[] }>;
      drainQueue: (id: string) => Promise<void>;
    };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.startingTurns.add(thread.id);
    internal.openSteerPrompt.set(thread.id, { text: 'Work on issue A', spawned: false, attachments: [] });
    internal.activeTurns.set(thread.id, { pid: 1, kill: vi.fn(), done: new Promise(() => {}) });

    const updated = await orch.send(thread.id, 'And the screenshot', { followUp: 'steer' });
    expect(updated.queue).toEqual([]);
    expect(updated.attachments).toEqual([]);
    expect(internal.openSteerPrompt.get(thread.id)?.attachments).toEqual([
      expect.objectContaining({ id: 'img-1' }),
    ]);
    expect(updated.messages.map((message) => message.text)).toEqual([
      'Work on issue A',
      'And the screenshot',
    ]);
    expect(updated.messages.at(-1)?.attachments?.[0]?.previewDataUrl).toBe('data:image/png;base64,xx');
  });

  it('keeps the image when steer interrupts a turn that has not replied', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seed(['later']);
    const img = shot('img-2', 'data:image/png;base64,yy');
    const live = readThread(thread.id)!;
    live.messages = [{ role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' }];
    live.attachments = [img];
    writeThread(live);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      openSteerPrompt: Map<string, { text: string; spawned: boolean }>;
      drainQueue: (id: string) => Promise<void>;
    };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.openSteerPrompt.set(thread.id, { text: 'Work on issue A', spawned: true });
    internal.activeTurns.set(thread.id, { pid: 1, kill: vi.fn(), done: new Promise(() => {}) });

    const updated = await orch.send(thread.id, 'And the screenshot', { followUp: 'steer' });
    expect(updated.attachments).toEqual([]);
    expect(updated.queue[0]).toBe('Work on issue A\nAnd the screenshot');
    expect(updated.queueAttachments?.[0]?.[0]?.id).toBe('img-2');
    expect(updated.messages.at(-1)?.attachments?.[0]?.previewDataUrl).toBe('data:image/png;base64,yy');
  });
});
