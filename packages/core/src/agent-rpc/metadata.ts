import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import { AGENT_RPC_PROTOCOL_VERSION } from './protocol.js';

export type AgentRuntimeTransport = {
  kind: 'websocket';
  url: string;
};

export type AgentRpcConnect = {
  url: string;
  authToken: string;
};

export type AgentRuntimeMetadata = {
  runtimeId: string;
  pid: number;
  protocolVersion: number;
  authToken: string;
  startedAt: number;
  transports: AgentRuntimeTransport[];
};

export function agentRuntimeMetadataPath(): string {
  return join(appDataDir(), 'agent-runtime.json');
}

export function writeAgentRuntimeMetadata(meta: AgentRuntimeMetadata): void {
  writeFileSync(agentRuntimeMetadataPath(), `${JSON.stringify(meta)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function readAgentRuntimeMetadata(): AgentRuntimeMetadata | null {
  try {
    const raw = JSON.parse(readFileSync(agentRuntimeMetadataPath(), 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.runtimeId !== 'string' || !rec.runtimeId.trim()) return null;
    if (typeof rec.authToken !== 'string' || !rec.authToken.trim()) return null;
    const pid = Number(rec.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const transports = Array.isArray(rec.transports) ? rec.transports : [];
    const ws = transports.filter((t): t is AgentRuntimeTransport => {
      if (!t || typeof t !== 'object') return false;
      const row = t as Record<string, unknown>;
      return row.kind === 'websocket' && typeof row.url === 'string' && Boolean(row.url.trim());
    });
    return {
      runtimeId: rec.runtimeId.trim(),
      pid,
      protocolVersion: Number(rec.protocolVersion) || AGENT_RPC_PROTOCOL_VERSION,
      authToken: rec.authToken,
      startedAt: Number(rec.startedAt) || 0,
      transports: ws,
    };
  } catch {
    return null;
  }
}

export function websocketUrlFromMetadata(meta: AgentRuntimeMetadata | null): string | null {
  const url = meta?.transports.find((t) => t.kind === 'websocket')?.url?.trim();
  return url || null;
}

/**
 * Connection details for a harness hook, or null when the agent must stay on
 * injected MCP. A metadata file left behind by a crashed desktop names a dead
 * pid; treating it as live would strip the MCP tools and leave the agent with
 * nothing, so liveness is part of the decision.
 */
export function agentRpcConnectFromMetadata(
  meta: AgentRuntimeMetadata | null = readAgentRuntimeMetadata(),
): AgentRpcConnect | null {
  if (!agentRuntimeLooksLive(meta)) return null;
  const url = websocketUrlFromMetadata(meta);
  const authToken = meta?.authToken;
  if (!url || !authToken) return null;
  return { url, authToken };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove the file only when it still names this process. */
export function clearAgentRuntimeMetadataIfOwned(pid = process.pid): void {
  const current = readAgentRuntimeMetadata();
  if (!current || current.pid !== pid) return;
  try {
    unlinkSync(agentRuntimeMetadataPath());
  } catch {
    // Already gone.
  }
}

export function agentRuntimeLooksLive(meta = readAgentRuntimeMetadata()): boolean {
  if (!meta) return false;
  return pidAlive(meta.pid);
}

export function agentRuntimeFileExists(): boolean {
  return existsSync(agentRuntimeMetadataPath());
}
