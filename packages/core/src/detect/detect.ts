import { getAdapter, allAdapters, ensureAgentPath, enrichPathWithNpmGlobalBin } from '../agents/index.js';
import type { AgentKind, AgentStatus } from '../types/thread.js';

export async function detectAgents(): Promise<AgentStatus[]> {
  ensureAgentPath();
  enrichPathWithNpmGlobalBin();
  return Promise.all(allAdapters().map((a) => a.detect()));
}

/**
 * Verify one agent is installed/authenticated.
 * Only probes that agent — never runs every detector. Nested `codex mcp list`
 * / `codex login status` while a parent `codex exec` holds ~/.codex SQLite locks
 * can block create_thread MCP forever.
 */
const REQUIRE_AGENT_TIMEOUT_MS = 8_000;

export async function requireAgent(
  agent: AgentKind,
  opts?: { requireLinear?: boolean },
): Promise<AgentStatus> {
  ensureAgentPath();
  enrichPathWithNpmGlobalBin();
  const status = await Promise.race([
    getAdapter(agent).detect(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `${agent} detect timed out after ${REQUIRE_AGENT_TIMEOUT_MS / 1000}s`,
          ),
        );
      }, REQUIRE_AGENT_TIMEOUT_MS);
    }),
  ]);
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
