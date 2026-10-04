import { WebSocket } from 'ws';
import {
  isJsonRpcNotification,
  parseRpcFrame,
  type JsonRpcId,
  type JsonRpcNotification,
} from './protocol.js';
import { agentRpcConnectFromMetadata, type AgentRpcConnect } from './metadata.js';

export type AgentRpcClientOptions = Partial<AgentRpcConnect>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

/**
 * JSON-RPC client for harness hooks (Cursor `customTools`). Construct it only
 * when the desktop runtime is live — `agentRpcConnectFromMetadata()` returns
 * null otherwise and the harness must stay on injected MCP.
 */
export class AgentRpcClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private readonly url: string;
  private readonly authToken: string;
  private readonly notifyListeners = new Set<(msg: JsonRpcNotification) => void>();

  constructor(opts: AgentRpcClientOptions = {}) {
    const connect =
      opts.url && opts.authToken
        ? { url: opts.url, authToken: opts.authToken }
        : agentRpcConnectFromMetadata();
    if (!connect) throw new Error('Agent RPC runtime is not running (no live agent-runtime.json)');
    this.url = connect.url;
    this.authToken = connect.authToken;
  }

  onNotify(fn: (msg: JsonRpcNotification) => void): () => void {
    this.notifyListeners.add(fn);
    return () => this.notifyListeners.delete(fn);
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const ws = await this.ensureSocket();
    const id: JsonRpcId = this.nextId;
    this.nextId += 1;
    const key = String(id);
    const payload = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
      authToken: this.authToken,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(key);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('message', (data) => this.onFrame(data.toString()));
    // Persistent listener: an un-listened `ws` 'error' is an uncaught
    // exception in the runner process. Fail in-flight calls instead.
    ws.on('error', (err) => this.drop(ws, err));
    ws.on('close', () => this.drop(ws, new Error('Agent RPC socket closed')));
    await new Promise<void>((resolve, reject) => {
      ws.once('error', reject);
      ws.once('open', () => {
        ws.off('error', reject);
        resolve();
      });
    });
    return ws;
  }

  private drop(ws: WebSocket, err: Error): void {
    if (this.ws === ws) this.ws = null;
    if (this.pending.size === 0) return;
    this.failAll(err);
  }

  private onFrame(raw: string): void {
    const parsed = parseRpcFrame(raw);
    if (parsed === undefined) return;
    if (isJsonRpcNotification(parsed)) {
      for (const fn of this.notifyListeners) fn(parsed);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const rec = parsed as Record<string, unknown>;
    if (rec.id === undefined || rec.id === null) return;
    const key = String(rec.id);
    const waiter = this.pending.get(key);
    if (!waiter) return;
    this.pending.delete(key);
    if (rec.error && typeof rec.error === 'object') {
      const err = rec.error as { message?: string };
      waiter.reject(new Error(err.message || 'Agent RPC error'));
      return;
    }
    waiter.resolve(rec.result);
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(err);
    this.pending.clear();
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.failAll(new Error('Agent RPC client closed'));
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }
}
