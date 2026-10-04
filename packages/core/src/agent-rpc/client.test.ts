import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRpcClient } from './client.js';
import { AgentRpcServer } from './server.js';

describe('AgentRpcClient', () => {
  let dataDir: string;
  let server: AgentRpcServer | null = null;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-agent-rpc-client-'));
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

  it('throws when no live runtime metadata exists', () => {
    expect(() => new AgentRpcClient()).toThrow(/not running/i);
  });

  it('rejects in-flight calls when the socket errors after open', async () => {
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
    const client = new AgentRpcClient({
      url: meta.transports[0]!.url,
      authToken: meta.authToken,
    });
    const hanging = client.call('runtime.hang');
    await vi.waitFor(() => expect(release).toBeDefined());
    // Attach before close: drop() rejects in-flight calls synchronously
    // when the server socket goes down.
    const rejected = expect(hanging).rejects.toThrow(/closed/i);
    await server.close();
    server = null;
    await rejected;
    client.close();
    release?.();
  });
});
