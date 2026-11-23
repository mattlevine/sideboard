import { getAdapter, allAdapters, ensureAgentPath, enrichPathWithNpmGlobalBin } from '../agents/index.js';
import { defaultAcpHarness, detectAcpHarness, detectAcpHarnesses } from '../agents/acp-harness.js';
import type { AcpHarnessId, AgentKind, AgentStatus } from '../types/thread.js';

export async function detectAgents(): Promise<AgentStatus[]> {
  ensureAgentPath();
  enrichPathWithNpmGlobalBin();
  const adapters = allAdapters().filter((adapter) => adapter.kind !== 'acp');
  const rows = await Promise.all(adapters.map((adapter) => adapter.detect()));
  return [...rows, ...(await detectAcpHarnesses())];
}

/**
 * Verify one agent is installed/authenticated.
 * Only probes that agent — never runs every detector. Nested `codex mcp list`
 * / `codex login status` while a parent `codex exec` holds ~/.codex SQLite locks
 * can block create_workspace MCP forever.
 */
const REQUIRE_AGENT_TIMEOUT_MS = 8_000;

export async function requireAgent(
  agent: AgentKind,
  opts?: { requireLinear?: boolean; acpHarness?: AcpHarnessId },
): Promise<AgentStatus> {
  ensureAgentPath();
  enrichPathWithNpmGlobalBin();
  const status = await Promise.race([
    agent === 'acp'
      ? detectAcpHarness(opts?.acpHarness ?? defaultAcpHarness())
      : getAdapter(agent).detect(),
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
