import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentRpcConnectFromMetadata,
  clearAgentRuntimeMetadataIfOwned,
  readAgentRuntimeMetadata,
  writeAgentRuntimeMetadata,
  websocketUrlFromMetadata,
} from './metadata.js';

/** Above every platform pid cap we ship on (macOS 99998, Linux 4194304). */
const DEAD_PID = 4_194_303;
import { AGENT_RPC_PROTOCOL_VERSION } from './protocol.js';

describe('agent-runtime metadata', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-agent-rpc-meta-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes mode 0600 and round-trips the websocket URL', () => {
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-1',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'secret-token',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    const meta = readAgentRuntimeMetadata();
    expect(meta?.runtimeId).toBe('rt-1');
    expect(meta?.authToken).toBe('secret-token');
    expect(websocketUrlFromMetadata(meta)).toBe('ws://127.0.0.1:9/agent-rpc');
    const mode = statSync(join(dataDir, 'agent-runtime.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clears the file only when this pid owns it', () => {
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-1',
      pid: process.pid + 1,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'x',
      startedAt: 1,
      transports: [],
    });
    clearAgentRuntimeMetadataIfOwned(process.pid);
    expect(readAgentRuntimeMetadata()?.runtimeId).toBe('rt-1');
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-2',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'x',
      startedAt: 1,
      transports: [],
    });
    clearAgentRuntimeMetadataIfOwned();
    expect(readAgentRuntimeMetadata()).toBeNull();
  });

  it('connects only to a live runtime; a stale file from a crashed desktop means stay on MCP', () => {
    expect(agentRpcConnectFromMetadata()).toBeNull();
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-dead',
      pid: DEAD_PID,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'stale',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    expect(agentRpcConnectFromMetadata()).toBeNull();
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-live',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'fresh',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    expect(agentRpcConnectFromMetadata()).toEqual({
      url: 'ws://127.0.0.1:9/agent-rpc',
      authToken: 'fresh',
    });
  });
});
