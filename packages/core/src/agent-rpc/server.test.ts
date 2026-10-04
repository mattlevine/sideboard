import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRpcServer } from './server.js';
import { AgentRpcClient } from './client.js';
import { createAgentRpcDispatcher, handleJobWait, type JobWaitFn } from './handlers.js';
import { readAgentRuntimeMetadata } from './metadata.js';
import { AGENT_RPC_PROTOCOL_VERSION } from './protocol.js';

describe('agent-rpc WebSocket server', () => {
  let dataDir: string;
  let server: AgentRpcServer | null = null;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-agent-rpc-ws-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects a bad auth token', async () => {
    server = new AgentRpcServer();
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new AgentRpcClient({ url: meta.transports[0]!.url, authToken: 'nope' });
    await expect(client.call('runtime.ping')).rejects.toThrow(/Unauthorized/i);
    client.close();
  });

  it('pings and presents over the live socket', async () => {
    server = new AgentRpcServer({ cwd: () => dataDir });
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    expect(readAgentRuntimeMetadata()?.runtimeId).toBe(meta.runtimeId);
    const client = new AgentRpcClient({ url: meta.transports[0]!.url, authToken: meta.authToken });
    const ping = (await client.call('runtime.ping')) as {
      ok: boolean;
      protocolVersion: number;
    };
    expect(ping.ok).toBe(true);
    expect(ping.protocolVersion).toBe(AGENT_RPC_PROTOCOL_VERSION);
    const presented = (await client.call('ui.presentArtifact', {
      title: 'Doc',
      type: 'markdown',
      content: '# hi',
      artifact_id: 'doc-1',
    })) as { artifact_id: string; ok: boolean };
    expect(presented.ok).toBe(true);
    expect(presented.artifact_id).toBe('doc-1');
    client.close();
  });

  it('job.wait resolves the job in the worktree cwd sent by the client, not the server cwd', async () => {
    const seenCwd: string[] = [];
    const waitFn: JobWaitFn = async (cwd, id) => {
      seenCwd.push(cwd);
      return {
        stillRunning: false,
        ok: true,
        failed: false,
        status: 'ok',
        id,
        delta: 'done',
        progress: 'ok',
      };
    };
    server = new AgentRpcServer({
      cwd: () => '/',
      handlers: {
        ...createAgentRpcDispatcher(),
        'job.wait': (params, ctx) => handleJobWait(params, ctx, waitFn),
      },
    });
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new AgentRpcClient({ url: meta.transports[0]!.url, authToken: meta.authToken });
    const result = (await client.call('job.wait', { id: 'job-1', cwd: dataDir })) as {
      ok: boolean;
      id: string;
    };
    expect(result.ok).toBe(true);
    expect(result.id).toBe('job-1');
    expect(seenCwd).toEqual([dataDir]);
    await expect(client.call('job.wait', { id: 'job-1', cwd: 'relative/path' })).rejects.toThrow(
      /absolute/i,
    );
    client.close();
  });

  it('close removes the metadata file first and fails in-flight calls', async () => {
    let release: (() => void) | undefined;
    server = new AgentRpcServer({
      handlers: {
        'runtime.hang': () =>
          new Promise<unknown>((resolve) => {
            release = () => resolve({ ok: true });
          }),
      },
    });
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new AgentRpcClient({ url: meta.transports[0]!.url, authToken: meta.authToken });
    const hanging = client.call('runtime.hang');
    await vi.waitFor(() => expect(release).toBeDefined());
    const rejected = expect(hanging).rejects.toThrow(/closed/i);
    const closing = server.close();
    expect(readAgentRuntimeMetadata()).toBeNull();
    await rejected;
    release?.();
    await closing;
    server = null;
    client.close();
  });
});
