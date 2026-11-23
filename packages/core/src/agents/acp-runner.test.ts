import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../types/thread.js';
import { runAcpTurn, type AcpTurnRequest } from './acp-runner.js';

const FAKE_AGENT = `
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_ACP_MODE || 'new';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}

let pendingPrompt = null;

function finishPrompt(msg, text) {
  const body = msg.params?.prompt?.[0]?.text || '';
  const marker = body.includes('Previous conversation') ? 'REPLAYED' : 'FRESH';
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: msg.params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: marker + ':' + text },
      },
    },
  });
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: msg.params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read README',
        kind: 'read',
        status: 'completed',
        rawInput: { path: 'README.md' },
        content: [{ type: 'text', text: 'ok' }],
      },
    },
  });
  send({
    jsonrpc: '2.0',
    id: msg.id,
    result: { stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 4 } },
  });
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: mode === 'load' },
      },
    });
    return;
  }
  if (msg.method === 'session/load') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: msg.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'OLD' },
        },
      },
    });
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-new' } });
    return;
  }
  if (msg.method === 'session/prompt') {
    if (mode === 'permission') {
      pendingPrompt = msg;
      send({
        jsonrpc: '2.0',
        id: 'perm-1',
        method: 'session/request_permission',
        params: {
          sessionId: msg.params.sessionId,
          toolCall: { toolCallId: 't1', title: 'Edit file', kind: 'edit' },
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
      return;
    }
    finishPrompt(msg, 'Hello');
    return;
  }
  if (msg.id === 'perm-1') {
    const optionId = msg.result?.outcome?.optionId || 'missing';
    finishPrompt(pendingPrompt, optionId);
  }
});
`;

function request(overrides: Partial<AcpTurnRequest> & { mode?: string }): AcpTurnRequest {
  const dir = mkdtempSync(join(tmpdir(), 'acp-fake-'));
  const script = join(dir, 'fake-acp.mjs');
  writeFileSync(script, FAKE_AGENT);
  const { mode, ...rest } = overrides;
  return {
    prompt: 'do the thing',
    resumePrompt: 'do the thing',
    cwd: dir,
    harness: 'gemini',
    command: process.execPath,
    args: [script],
    env: { FAKE_ACP_MODE: mode ?? 'new' },
    ...rest,
  };
}

async function run(overrides: Partial<AcpTurnRequest> & { mode?: string }) {
  const events: AgentEvent[] = [];
  const code = await runAcpTurn(request(overrides), (event) => events.push(event));
  return { code, events };
}

describe('ACP runner', () => {
  it('opens a new session and maps the turn when the harness cannot load one', async () => {
    const { code, events } = await run({
      mode: 'new',
      sessionId: 'stale',
      transcript: [
        { role: 'user', text: 'earlier' },
        { role: 'agent', text: 'done' },
      ],
    });
    expect(code).toBe(0);
    expect(events).toContainEqual({ type: 'session_id', data: 'sess-new' });
    expect(events.some((event) => event.type === 'stdout' && event.data.startsWith('REPLAYED:'))).toBe(
      true,
    );
    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'call-1',
      name: 'Read README',
      input: { path: 'README.md' },
    });
    expect(events).toContainEqual({
      type: 'usage',
      data: { inputTokens: 3, outputTokens: 4 },
      scope: 'turn',
    });
  });

  it('loads a session and hides the replayed history', async () => {
    const { code, events } = await run({
      mode: 'load',
      sessionId: 'sess-old',
      transcript: [{ role: 'user', text: 'earlier' }],
    });
    expect(code).toBe(0);
    expect(events).toContainEqual({ type: 'session_id', data: 'sess-old' });
    expect(events.some((event) => event.type === 'stdout' && event.data.includes('OLD'))).toBe(false);
    expect(events.some((event) => event.type === 'stdout' && event.data.startsWith('FRESH:'))).toBe(
      true,
    );
  });

  it('rejects a write permission while plan mode is on', async () => {
    const { code, events } = await run({ mode: 'permission', planMode: true });
    expect(code).toBe(0);
    expect(events.some((event) => event.type === 'stdout' && event.data.includes('no'))).toBe(true);
  });
});
