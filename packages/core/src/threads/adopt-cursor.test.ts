import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveConductorCursorAgentId', () => {
  const prevHome = process.env.HOME;
  let home: string;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  it('picks the newest durable agent for a workspace cwd', async () => {
    home = mkdtempSync(join(tmpdir(), 'sb-cursor-adopt-'));
    process.env.HOME = home;
    const store = join(home, 'Library', 'Application Support', 'com.conductor.app', 'cursor-sdk-store', 'abc');
    mkdirSync(store, { recursive: true });
    writeFileSync(
      join(store, 'agents.ndjson'),
      [
        JSON.stringify({
          agentId: 'old-agent',
          cwd: '/tmp/wt',
          updatedAt: 100,
        }),
        JSON.stringify({
          agentId: 'conductor-one-shot-skip',
          cwd: '/tmp/wt',
          updatedAt: 999,
        }),
        JSON.stringify({
          agentId: 'new-agent',
          cwd: '/tmp/wt',
          updatedAt: 200,
        }),
        JSON.stringify({
          agentId: 'other-cwd',
          cwd: '/tmp/other',
          updatedAt: 500,
        }),
      ].join('\n'),
    );

    const { resolveConductorCursorAgentId } = await import('./adopt.js');
    expect(resolveConductorCursorAgentId('/tmp/wt')).toBe('new-agent');
    expect(resolveConductorCursorAgentId('/tmp/wt/')).toBe('new-agent');
    expect(resolveConductorCursorAgentId('/tmp/missing')).toBeNull();
  });
});
