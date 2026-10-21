import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, invalidateThreadListCache, writeThread } from '../store/thread-store.js';
import { stashMcpAppModelContext, takeMcpAppModelContext } from './model-context.js';

describe('mcp app model context', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-mcp-ctx-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    invalidateThreadListCache();
  });

  afterEach(() => {
    invalidateThreadListCache();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stashes and consumes the last update', () => {
    const thread = createEmptyThread({
      title: 't',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'main',
      worktreePath: dataDir,
      repoPath: dataDir,
      agent: 'claude',
    });
    writeThread(thread);
    expect(takeMcpAppModelContext(thread.id)).toBeUndefined();
    stashMcpAppModelContext(thread.id, 'MCP App context:\nscore 8');
    stashMcpAppModelContext(thread.id, 'MCP App context:\nscore 9');
    expect(takeMcpAppModelContext(thread.id)).toBe('MCP App context:\nscore 9');
    expect(takeMcpAppModelContext(thread.id)).toBeUndefined();
  });
});
