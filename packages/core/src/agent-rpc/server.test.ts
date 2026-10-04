import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRpcServer } from './server.js';
import { AgentRpcClient } from './client.js';
import { createAgentRpcDispatcher, handleJobWait, handleTurnWait, type JobWaitFn, type TurnWaitFn } from './handlers.js';
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

  it('rejects an unauthenticated WebSocket upgrade', async () => {
    server = new AgentRpcServer();
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(meta.transports[0]!.url);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        resolve(res.statusCode);
      });
      ws.once('open', () => {
        ws.close();
        reject(new Error('unauthenticated upgrade was accepted'));
      });
      ws.once('error', (err) => {
        if (/401/.test(err.message)) resolve(401);
      });
    });
    expect(status).toBe(401);
  });

  it('rejects a request with a missing authToken on an otherwise authenticated socket', async () => {
    server = new AgentRpcServer();
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const { WebSocket } = await import('ws');
    const url = new URL(meta.transports[0]!.url);
    url.searchParams.set('authToken', meta.authToken);
    const ws = new WebSocket(url.toString());
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const reply = new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' }));
    const parsed = JSON.parse(await reply) as { error?: { code: number; message: string } };
    expect(parsed.error?.code).toBe(-32001);
    expect(parsed.error?.message).toMatch(/Unauthorized/i);
    ws.close();
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

  it('turn.wait holds on the socket and streams runtime.progress', async () => {
    const slices = [
      {
        id: 'child-1',
        status: 'running' as const,
        taskState: 'working' as const,
        text: '',
        lastError: null,
        stillRunning: true,
        progress: 'Read a.ts',
        lastActivityAt: 't1',
        hint: 'working',
        incomplete: false,
      },
      {
        id: 'child-1',
        status: 'idle' as const,
        taskState: 'completed' as const,
        text: 'ok',
        lastError: null,
        stillRunning: false,
        progress: null,
        lastActivityAt: 't2',
        hint: undefined,
        incomplete: false,
      },
    ];
    const waitFn: TurnWaitFn = async () => slices.shift()!;
    server = new AgentRpcServer({
      handlers: {
        ...createAgentRpcDispatcher(),
        'turn.wait': (params, ctx) => handleTurnWait(params, ctx, waitFn),
      },
    });
    const meta = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new AgentRpcClient({ url: meta.transports[0]!.url, authToken: meta.authToken });
    const progress: unknown[] = [];
    client.onNotify((msg) => {
      if (msg.method === 'runtime.progress') progress.push(msg.params);
    });
    const result = (await client.call('turn.wait', { ref: 'child-1' })) as {
      stillRunning: boolean;
      taskState: string;
      text: string;
    };
    expect(result.stillRunning).toBe(false);
    expect(result.taskState).toBe('completed');
    expect(result.text).toBe('ok');
    expect(progress).toHaveLength(1);
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
