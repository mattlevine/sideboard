import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repairCursorLocalCatalog } from './cursor-catalog.js';

const agent = {
  agentId: 'agent-1',
  cwd: '/repo',
  status: 'idle',
  activeRunId: null,
  name: 'Sideboard',
  createdAt: 1,
  updatedAt: 10,
  latestCheckpoint: { schemaVersion: 1, rootBlobId: 'blob-new' },
};

describe('repairCursorLocalCatalog', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function setup(): string {
    dir = mkdtempSync(join(tmpdir(), 'cursor-catalog-'));
    return dir;
  }

  it('rolls the agent back to a checkpoint blob that is still on disk', () => {
    const root = setup();
    writeFileSync(join(root, 'agents.ndjson'), `${JSON.stringify(agent)}\n`);
    writeFileSync(
      join(root, 'checkpoints.ndjson'),
      `${JSON.stringify({ agentId: 'agent-1', blobId: 'blob-old', dataBase64: 'YQ==' })}\n`,
    );
    writeFileSync(
      join(root, 'runs.ndjson'),
      `${JSON.stringify({
        agentId: 'agent-1',
        runId: 'run-1',
        status: 'finished',
        updatedAt: 5,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: 'blob-old' },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: 'blob-new' },
      })}\n`,
    );

    const result = repairCursorLocalCatalog(root);
    expect(result.repaired).toBe(true);
    expect(result.notes.join('\n')).toMatch(/blob-old/);
    const saved = JSON.parse(readFileSync(join(root, 'agents.ndjson'), 'utf8')) as {
      latestCheckpoint: { rootBlobId: string };
    };
    expect(saved.latestCheckpoint.rootBlobId).toBe('blob-old');
  });

  it('puts an agent row back from an interrupted rewrite', () => {
    const root = setup();
    writeFileSync(join(root, 'agents.ndjson'), '');
    writeFileSync(
      join(root, '.agents.ndjson.a1b2c3d4e5f67890.tmp'),
      `${JSON.stringify({ ...agent, latestCheckpoint: { schemaVersion: 1, rootBlobId: 'blob-old' } })}\n`,
    );
    writeFileSync(
      join(root, 'checkpoints.ndjson'),
      `${JSON.stringify({ agentId: 'agent-1', blobId: 'blob-old', dataBase64: 'YQ==' })}\n`,
    );

    const result = repairCursorLocalCatalog(root);
    expect(result.repaired).toBe(true);
    const saved = JSON.parse(readFileSync(join(root, 'agents.ndjson'), 'utf8')) as {
      agentId: string;
    };
    expect(saved.agentId).toBe('agent-1');
    expect(existsSync(join(root, '.agents.ndjson.a1b2c3d4e5f67890.tmp'))).toBe(false);
  });

  it('merges a checkpoint blob that only exists in the temp file', () => {
    const root = setup();
    const pointing = {
      ...agent,
      latestCheckpoint: { schemaVersion: 1, rootBlobId: 'blob-new' },
    };
    writeFileSync(join(root, 'agents.ndjson'), `${JSON.stringify(pointing)}\n`);
    writeFileSync(
      join(root, 'checkpoints.ndjson'),
      `${JSON.stringify({ agentId: 'agent-1', blobId: 'blob-old', dataBase64: 'YQ==' })}\n`,
    );
    writeFileSync(
      join(root, '.checkpoints.ndjson.abcdef0123456789.tmp'),
      [
        JSON.stringify({ agentId: 'agent-1', blobId: 'blob-old', dataBase64: 'YQ==' }),
        JSON.stringify({ agentId: 'agent-1', blobId: 'blob-new', dataBase64: 'Yg==' }),
        '{"truncated":',
      ].join('\n'),
    );

    const result = repairCursorLocalCatalog(root);
    expect(result.repaired).toBe(true);
    const lines = readFileSync(join(root, 'checkpoints.ndjson'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { blobId: string });
    expect(lines.map((row) => row.blobId)).toEqual(['blob-old', 'blob-new']);
    const saved = JSON.parse(readFileSync(join(root, 'agents.ndjson'), 'utf8')) as {
      latestCheckpoint: { rootBlobId: string };
    };
    expect(saved.latestCheckpoint.rootBlobId).toBe('blob-new');
  });

  it('clears an active run the catalog no longer has', () => {
    const root = setup();
    writeFileSync(
      join(root, 'agents.ndjson'),
      `${JSON.stringify({
        ...agent,
        status: 'running',
        activeRunId: 'run-missing',
        latestCheckpoint: { schemaVersion: 1, rootBlobId: 'blob-old' },
      })}\n`,
    );
    writeFileSync(
      join(root, 'checkpoints.ndjson'),
      `${JSON.stringify({ agentId: 'agent-1', blobId: 'blob-old', dataBase64: 'YQ==' })}\n`,
    );
    mkdirSync(join(root, 'unused'), { recursive: true });

    const result = repairCursorLocalCatalog(root);
    expect(result.repaired).toBe(true);
    const saved = JSON.parse(readFileSync(join(root, 'agents.ndjson'), 'utf8')) as {
      activeRunId: string | null;
      status: string;
    };
    expect(saved.activeRunId).toBeNull();
    expect(saved.status).toBe('idle');
  });

  it('leaves a consistent catalog untouched', () => {
    const root = setup();
    const body = `${JSON.stringify({
      ...agent,
      latestCheckpoint: { schemaVersion: 1, rootBlobId: 'blob-old' },
    })}\n`;
    writeFileSync(join(root, 'agents.ndjson'), body);
    const result = repairCursorLocalCatalog(root);
    expect(result.repaired).toBe(false);
    expect(result.notes).toEqual([]);
    expect(readFileSync(join(root, 'agents.ndjson'), 'utf8')).toBe(body);
  });
});
