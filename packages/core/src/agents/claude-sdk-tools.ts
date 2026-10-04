import { z } from 'zod';
import {
  createPilotRpcExecutors,
  PILOT_TOOL_DESCRIPTIONS,
  type PilotRpcExecutors,
} from '../agent-rpc/pilot-tools.js';
import { AGENT_RPC_CLAUDE_SDK_SERVER } from '../agent-rpc/protocol.js';
import type { AgentRpcConnect } from '../agent-rpc/metadata.js';

type ToolFn = (
  name: string,
  description: string,
  schema: unknown,
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
) => unknown;

type CreateSdkMcpServerFn = (opts: {
  name: string;
  version?: string;
  timeout?: number;
  tools: unknown[];
}) => unknown;

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function createClaudePilotSdkServer(
  createSdkMcpServer: CreateSdkMcpServerFn,
  tool: ToolFn,
  opts: { cwd: string; rpc: AgentRpcConnect },
): { server: unknown; exec: PilotRpcExecutors } {
  const exec = createPilotRpcExecutors(opts);
  const server = createSdkMcpServer({
    name: AGENT_RPC_CLAUDE_SDK_SERVER,
    version: '1.0.0',
    timeout: 180_000,
    tools: [
      tool(
        'present_artifact',
        PILOT_TOOL_DESCRIPTIONS.present_artifact,
        {
          title: z.string(),
          type: z.enum(['html', 'svg', 'markdown', 'react', 'log']),
          content: z.string(),
          artifact_id: z.string().optional(),
          status: z.enum(['running', 'ok', 'failed', 'idle']).optional(),
          phase: z.string().optional(),
          mode: z.enum(['append', 'replace']).optional(),
        },
        async (args) => textResult(await exec.present_artifact(args as Record<string, unknown>)),
      ),
      tool(
        'wait_for_job',
        PILOT_TOOL_DESCRIPTIONS.wait_for_job,
        { id: z.string() },
        async (args) => textResult(await exec.wait_for_job(args as Record<string, unknown>)),
      ),
      tool(
        'stop_job',
        PILOT_TOOL_DESCRIPTIONS.stop_job,
        { id: z.string(), reason: z.string().optional() },
        async (args) => textResult(await exec.stop_job(args as Record<string, unknown>)),
      ),
    ],
  });
  return { server, exec };
}
