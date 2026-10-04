#!/usr/bin/env node
/**
 * Node runner that registers Agent RPC pilot tools as Claude Agent SDK
 * in-process MCP (`createSdkMcpServer`) and prints Claude stream-json lines.
 */
import { createInterface } from 'node:readline';
import { AGENT_RPC_CLAUDE_SDK_SERVER } from '../agent-rpc/protocol.js';
import { dropNestedElectronEnvFromProcess } from '../hook/nested-electron-env.js';
import { createClaudePilotSdkServer } from './claude-sdk-tools.js';
import type { ClaudeTurnRequest } from './claude-turn-request.js';

dropNestedElectronEnvFromProcess();

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const chunks: string[] = [];
  for await (const line of rl) chunks.push(line);
  return chunks.join('\n').trim();
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw) {
    emit({ type: 'stderr', data: 'claude-runner: empty stdin' });
    process.exitCode = 1;
    return;
  }
  const req = JSON.parse(raw) as ClaudeTurnRequest;
  if (!req.prompt || !req.cwd || !req.agentRpc || !req.claudePath) {
    emit({ type: 'stderr', data: 'claude-runner: prompt, cwd, claudePath, and agentRpc are required' });
    process.exitCode = 1;
    return;
  }

  let sdk: {
    query: (opts: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>;
    tool: (...args: never[]) => unknown;
    createSdkMcpServer: (opts: Record<string, unknown>) => unknown;
  };
  try {
    sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as typeof sdk;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: 'stderr',
      data: `claude-runner: @anthropic-ai/claude-agent-sdk is required (${message})`,
    });
    process.exitCode = 1;
    return;
  }

  const { server, exec } = createClaudePilotSdkServer(
    sdk.createSdkMcpServer as Parameters<typeof createClaudePilotSdkServer>[0],
    sdk.tool as Parameters<typeof createClaudePilotSdkServer>[1],
    { cwd: req.cwd, rpc: req.agentRpc },
  );
  const mcpServers: Record<string, unknown> = {
    [AGENT_RPC_CLAUDE_SDK_SERVER]: server,
  };
  for (const [name, spec] of Object.entries(req.mcpServers ?? {})) {
    mcpServers[name] = {
      command: spec.command,
      args: spec.args ?? [],
      env: spec.env,
    };
  }

  try {
    const options: Record<string, unknown> = {
      cwd: req.cwd,
      pathToClaudeCodeExecutable: req.claudePath,
      permissionMode: req.permissionMode,
      allowedTools: req.allowedTools,
      mcpServers,
      includePartialMessages: true,
    };
    if (req.sessionId) options.resume = req.sessionId;
    if (req.model) options.model = req.model;
    if (req.systemPrompt) options.appendSystemPrompt = req.systemPrompt;
    if (req.effort) options.effort = req.effort;
    if (req.chrome) options.chrome = true;
    if (req.isolateClaudeAiMcp) options.settingSources = [];

    for await (const message of sdk.query({ prompt: req.prompt, options })) {
      emit(message);
    }
  } finally {
    exec.close();
  }
}

main().catch((err) => {
  emit({
    type: 'stderr',
    data: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
