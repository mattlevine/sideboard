#!/usr/bin/env node
/**
 * Speaks the Agent Client Protocol to one harness (Gemini CLI, Copilot CLI, …).
 * Reads an AcpTurnRequest JSON blob from stdin. Writes Sideboard AgentEvent
 * NDJSON on stdout. Harness logs stay on the harness stderr and are forwarded
 * as stderr events.
 *
 * Exit codes: 0 finished, 1 startup/config failure, 2 the turn was refused or cancelled.
 *
 * Resume: session/load only when initialize reports loadSession. Otherwise
 * session/new plus a transcript replay. This process exits at the end of the turn.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { AgentEvent } from '../types/thread.js';
import type { AcpHarnessId } from './acp-harness.js';
import {
  ACP_PROTOCOL_VERSION,
  acpSessionOpenPlan,
  acpUsageFromUnknown,
  buildAcpReplayPrompt,
  selectAcpPermissionOption,
  sessionUpdateToEvents,
  type AcpMcpServer,
  type AcpPermissionMode,
  type AcpPermissionOption,
  type AcpTranscriptTurn,
} from './acp-protocol.js';

export type AcpTurnRequest = {
  prompt: string;
  /** Prompt without the cached prefix. Used only after a successful session/load. */
  resumePrompt: string;
  transcript?: AcpTranscriptTurn[];
  cwd: string;
  sessionId?: string | null;
  harness: AcpHarnessId;
  command: string;
  args: string[];
  mcpServers?: AcpMcpServer[];
  planMode?: boolean;
  autonomy?: 'default' | 'full';
  /** Extra env for the harness (tests). Inherited env is always passed through. */
  env?: Record<string, string>;
};

type RpcId = number | string;

type RpcMessage = {
  id?: RpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; data?: unknown };
};

function emitLine(emit: (event: AgentEvent) => void, event: AgentEvent): void {
  emit(event);
}

function permissionMode(req: AcpTurnRequest): AcpPermissionMode {
  if (req.planMode) return 'plan';
  if (req.autonomy === 'full') return 'full';
  return 'default';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

class AcpConnection {
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private buffer = '';

  constructor(
    private readonly stdin: NodeJS.WritableStream,
    stdout: NodeJS.ReadableStream,
    private readonly onRequest: (method: string, params: unknown) => Promise<unknown>,
    private readonly onNotification: (method: string, params: unknown) => void,
  ) {
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => this.ingest(chunk));
    stdout.on('end', () => {
      this.failAll(new Error('ACP harness closed stdout'));
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      void this.dispatch(msg);
    }
  }

  private async dispatch(msg: RpcMessage): Promise<void> {
    if (msg.method && (msg.id === undefined || msg.id === null)) {
      this.onNotification(msg.method, msg.params);
      return;
    }
    if (msg.method && msg.id != null) {
      try {
        const result = await this.onRequest(msg.method, msg.params);
        this.send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message },
        });
      }
      return;
    }
    if (msg.id == null) return;
    const pending = this.pending.get(String(msg.id));
    if (!pending) return;
    this.pending.delete(String(msg.id));
    if (msg.error) {
      const data = asRecord(msg.error.data);
      const code = typeof data?.code === 'string' ? data.code : '';
      const message = msg.error.message || code || 'ACP request failed';
      pending.reject(new Error(code ? `${message} (${code})` : message));
      return;
    }
    pending.resolve(msg.result);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
    });
    this.send({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(value: unknown): void {
    this.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function permissionOptions(value: unknown): AcpPermissionOption[] {
  if (!Array.isArray(value)) return [];
  const options: AcpPermissionOption[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.optionId !== 'string' || typeof record.kind !== 'string') continue;
    options.push({
      optionId: record.optionId,
      kind: record.kind,
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
    });
  }
  return options;
}

async function readStdinJson(): Promise<AcpTurnRequest> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const chunks: string[] = [];
  for await (const line of rl) chunks.push(line);
  const raw = chunks.join('\n').trim();
  if (!raw) throw new Error('acp-runner: empty stdin (expected JSON AcpTurnRequest)');
  return JSON.parse(raw) as AcpTurnRequest;
}

function exitWhenDone(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode != null) {
      resolveExit(child.exitCode);
      return;
    }
    child.once('exit', (code) => resolveExit(code));
  });
}

export async function runAcpTurn(
  req: AcpTurnRequest,
  emit: (event: AgentEvent) => void,
): Promise<number> {
  if (!req.prompt?.trim()) {
    emitLine(emit, { type: 'stderr', data: 'acp-runner: prompt is required' });
    return 1;
  }
  if (!req.cwd?.trim() || !req.command?.trim()) {
    emitLine(emit, { type: 'stderr', data: 'acp-runner: cwd and command are required' });
    return 1;
  }

  const cwd = resolve(req.cwd);
  const child = spawn(req.command, req.args ?? [], {
    cwd,
    env: { ...process.env, ...req.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stderr.setEncoding('utf8');
  let stderrBuf = '';
  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    while (stderrBuf.includes('\n')) {
      const nl = stderrBuf.indexOf('\n');
      const line = stderrBuf.slice(0, nl).replace(/\r$/, '');
      stderrBuf = stderrBuf.slice(nl + 1);
      if (line.trim()) emitLine(emit, { type: 'stderr', data: line });
    }
  });

  let suppressUpdates = false;
  let sessionId = req.sessionId?.trim() || null;
  const mode = permissionMode(req);
  const mcpServers = req.mcpServers ?? [];

  const conn = new AcpConnection(
    child.stdin,
    child.stdout,
    async (method, params) => {
      if (method === 'session/request_permission') {
        const record = asRecord(params);
        const tool = asRecord(record?.toolCall);
        const toolKind = typeof tool?.kind === 'string' ? tool.kind : null;
        const selected = selectAcpPermissionOption(permissionOptions(record?.options), mode, toolKind);
        return { outcome: selected };
      }
      throw new Error(`ACP client method not implemented: ${method}`);
    },
    (method, params) => {
      if (method !== 'session/update' || suppressUpdates) return;
      for (const event of sessionUpdateToEvents(params)) emitLine(emit, event);
    },
  );

  let stopWatching = false;
  const earlyFailure = new Promise<number>((resolveExit) => {
    child.once('error', (err) => {
      if (stopWatching) return;
      stopWatching = true;
      emitLine(emit, { type: 'stderr', data: err.message });
      resolveExit(1);
    });
    child.once('exit', (code) => {
      if (stopWatching) return;
      stopWatching = true;
      emitLine(emit, {
        type: 'stderr',
        data: `ACP harness exited (${code ?? 'null'}) before the turn finished`,
      });
      resolveExit(1);
    });
  });

  const turn = (async () => {
    const init = asRecord(
      await conn.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'sideboard', version: '0' },
      }),
    );
    const capabilities = asRecord(init?.agentCapabilities);
    const loadSession = capabilities?.loadSession === true;
    let loaded = false;
    if (acpSessionOpenPlan({ loadSession, sessionId }) === 'load' && sessionId) {
      suppressUpdates = true;
      try {
        await conn.request('session/load', { sessionId, cwd, mcpServers });
        loaded = true;
        emitLine(emit, { type: 'session_id', data: sessionId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitLine(emit, {
          type: 'stderr',
          data: `ACP session/load failed (${message}). Starting a new session and replaying the transcript.`,
        });
        sessionId = null;
      } finally {
        suppressUpdates = false;
      }
    }
    if (!loaded) {
      const created = asRecord(await conn.request('session/new', { cwd, mcpServers }));
      const createdId = typeof created?.sessionId === 'string' ? created.sessionId.trim() : '';
      if (!createdId) throw new Error('ACP session/new did not return a sessionId');
      sessionId = createdId;
      emitLine(emit, { type: 'session_id', data: createdId });
    }

    const text = loaded
      ? req.resumePrompt || req.prompt
      : buildAcpReplayPrompt(req.transcript ?? [], req.prompt);
    const result = asRecord(
      await conn.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      }),
    );
    const usage = acpUsageFromUnknown(result?.usage);
    if (usage) emitLine(emit, { type: 'usage', data: usage, scope: 'turn' });
    const stop = typeof result?.stopReason === 'string' ? result.stopReason : 'end_turn';
    if (stop === 'refusal' || stop === 'cancelled') {
      emitLine(emit, { type: 'stderr', data: `ACP turn stopped: ${stop}` });
      return 2;
    }
    if (stop !== 'end_turn') {
      emitLine(emit, { type: 'stderr', data: `ACP stop reason: ${stop}` });
    }
    return 0;
  })();

  const settled = turn.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  const raced = await Promise.race([
    settled.then((result) => {
      stopWatching = true;
      return result;
    }),
    earlyFailure.then((value) => ({ ok: true as const, value, early: true as const })),
  ]);
  const code = 'early' in raced ? raced.value : raced.ok ? raced.value : 1;
  if (!('early' in raced) && !raced.ok) {
    const message = raced.err instanceof Error ? raced.err.message : String(raced.err);
    emitLine(emit, { type: 'stderr', data: message });
  }
  stopWatching = true;
  if (code !== 0 && sessionId) {
    try {
      conn.notify('session/cancel', { sessionId });
    } catch {
      // The harness may already be gone.
    }
  }
  child.stdin.end();
  const finished = exitWhenDone(child);
  const timed = await Promise.race([
    finished,
    new Promise<number | null>((resolveExit) => {
      setTimeout(() => resolveExit(null), 3_000);
    }),
  ]);
  if (timed == null) child.kill('SIGTERM');
  return code;
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1] ?? '';
  const base = argv1.split(/[/\\]/).pop() ?? '';
  return base === 'acp-runner.ts' || base === 'acp-runner.js' || base === 'acp-runner.cjs';
}

if (isDirectRun()) {
  readStdinJson()
    .then((req) =>
      runAcpTurn(req, (event) => {
        process.stdout.write(`${JSON.stringify(event)}\n`);
      }),
    )
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${JSON.stringify({ type: 'stderr', data: message })}\n`);
      process.exitCode = 1;
    });
}
