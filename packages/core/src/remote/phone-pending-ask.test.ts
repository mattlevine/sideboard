import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { PHONE_CONTROL_PREFIX } from './phone-chats.js';
import { republishPendingAsk } from './phone-pending-ask.js';
import type { RemoteOutbound } from './phone-live.js';

const askPart = {
  type: 'tool' as const,
  id: 'q1',
  name: 'ask_user',
  input: {
    questions: [
      {
        question: 'Ship the reconnect fix?',
        options: [
          { label: 'Patch and rerun CI', description: 'Land the fix' },
          { label: 'Leave it red' },
        ],
      },
    ],
  },
  status: 'done' as const,
};

function outboundAsk(sent: RemoteOutbound[]): { op: string; text: string; questions: unknown[] } | null {
  const last = sent.at(-1);
  if (!last || last.type !== 'assistant' || !last.text.startsWith(PHONE_CONTROL_PREFIX)) return null;
  return JSON.parse(last.text.slice(PHONE_CONTROL_PREFIX.length));
}

describe('republishPendingAsk', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-ask-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('resends the pending choices with no second bubble', () => {
    const thread = createEmptyThread({
      title: 'api-auth',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/api-auth',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    writeThread({
      ...thread,
      messages: [
        {
          role: 'agent',
          text: 'CI is red.',
          ts: thread.createdAt,
          parts: [askPart],
        },
      ],
    });
    const sent: RemoteOutbound[] = [];
    republishPendingAsk({ onOutbound: (msg) => sent.push(msg) }, thread.id);
    expect(outboundAsk(sent)).toEqual({
      op: 'ask',
      chatId: thread.id,
      text: '',
      questions: [
        {
          question: 'Ship the reconnect fix?',
          options: [
            { label: 'Patch and rerun CI', description: 'Land the fix' },
            { label: 'Leave it red' },
          ],
        },
      ],
    });
  });

  it('stays quiet after the user has answered', () => {
    const thread = createEmptyThread({
      title: 'api-auth',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/api-auth',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    writeThread({
      ...thread,
      messages: [
        { role: 'agent', text: 'CI is red.', ts: thread.createdAt, parts: [askPart] },
        { role: 'user', text: 'Leave it red', ts: thread.createdAt },
      ],
    });
    const sent: RemoteOutbound[] = [];
    republishPendingAsk({ onOutbound: (msg) => sent.push(msg) }, thread.id);
    expect(sent).toEqual([]);
  });
});
