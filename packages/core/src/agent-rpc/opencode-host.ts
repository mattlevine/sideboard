import type { Thread } from '../types/thread.js';
import {
  buildInjectedMcpServers,
  shouldInjectBrightsyMcp,
  toOpencodeMcpConfigContent,
} from '../agents/injected-mcp.js';
import {
  listUserOpencodeMcpNames,
  userMcpNamesToDisable,
} from '../agents/orch-mcp-isolation.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { writeOpencodeRpcPlugin } from './opencode-hook.js';
import { agentRpcChildEnv, worktreeAgentRpc } from './rpc-env.js';

export async function buildOpencodeHostEnv(
  thread: Thread,
): Promise<Record<string, string>> {
  const isOrchestrator = isOrchestratorThread(thread);
  const rpc = worktreeAgentRpc(isOrchestrator);
  const injected = await buildInjectedMcpServers({
    includeSideboard: true,
    includeBrightsy: shouldInjectBrightsyMcp(thread, {
      orchestrator: isOrchestrator,
    }),
    orchestratorThreadId: isOrchestrator ? thread.id : null,
    threadId: thread.id,
    rpcNativeTools: Boolean(rpc),
  });
  const disableNames = isOrchestrator
    ? userMcpNamesToDisable({
        injectedNames: injected.map((s) => s.name),
        names: listUserOpencodeMcpNames(),
      })
    : [];
  const config: Record<string, unknown> =
    injected.length > 0 || disableNames.length > 0
      ? (JSON.parse(toOpencodeMcpConfigContent(injected, { disableNames })) as Record<
          string,
          unknown
        >)
      : {};
  const env: Record<string, string> = {};
  if (rpc) {
    const { configDir, pluginFile } = writeOpencodeRpcPlugin();
    env.OPENCODE_CONFIG_DIR = configDir;
    Object.assign(env, agentRpcChildEnv(rpc, thread.worktreePath));
    config.plugin = [pluginFile];
  }
  if (Object.keys(config).length > 0) {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  }
  return env;
}
