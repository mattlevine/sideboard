import { describe, expect, it } from 'vitest';
import { CURSOR_STREAM_IDLE_MS } from '../agents/cursor-session.js';
import {
  AGENT_RPC_JOB_HOLD_MAX_MS,
  isJsonRpcNotification,
  isJsonRpcRequest,
  parseRpcFrame,
  rpcError,
  rpcNotify,
  rpcResult,
} from './protocol.js';

describe('agent-rpc protocol', () => {
  it('accepts JSON-RPC requests with an id', () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'runtime.ping',
        authToken: 't',
      }),
    ).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'runtime.ping' })).toBe(false);
  });

  it('treats id-less method frames as notifications', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'runtime.progress' })).toBe(true);
    expect(
      isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' }),
    ).toBe(false);
  });

  it('parses frames and rejects invalid JSON', () => {
    expect(parseRpcFrame('{"jsonrpc":"2.0"}')).toEqual({ jsonrpc: '2.0' });
    expect(parseRpcFrame('not-json')).toBeUndefined();
  });

  it('builds result, error, and notify envelopes', () => {
    expect(rpcResult(1, { ok: true })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
    expect(rpcError(1, -32001, 'Unauthorized').error.code).toBe(-32001);
    expect(rpcNotify('runtime.progress', { stillRunning: true }).method).toBe(
      'runtime.progress',
    );
  });

  it('caps job.wait and turn.wait below the Cursor stream idle guard', () => {
    expect(AGENT_RPC_JOB_HOLD_MAX_MS).toBeLessThan(CURSOR_STREAM_IDLE_MS);
  });
});
