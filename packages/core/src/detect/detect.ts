import { allAdapters } from '../agents/index.js';
import type { AgentStatus } from '../types/thread.js';

export async function detectAgents(): Promise<AgentStatus[]> {
  return Promise.all(allAdapters().map((a) => a.detect()));
}

export async function requireAgent(
  agent: AgentStatus['agent'],
  opts?: { requireLinear?: boolean },
): Promise<AgentStatus> {
  const status = (await detectAgents()).find((s) => s.agent === agent);
  if (!status) throw new Error(`Unknown agent: ${agent}`);
  if (!status.installed || !status.authenticated) {
    throw new Error(status.reason ?? `${agent} is not available`);
  }
  if (opts?.requireLinear && !status.linearMcp) {
    throw new Error(
      `${agent} has no Linear MCP server configured — ticket sources require it`,
    );
  }
  return status;
}
