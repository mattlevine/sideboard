/**
 * Clip every Sideboard MCP tool result before it is returned to Claude / Cursor /
 * Codex / OpenCode. One wrap at registration — tools do not opt out.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { clipMcpToolResult } from '../agents/tool-result-clip.js';

type ToolFn = (...args: unknown[]) => unknown;

function wrapToolCallback(fn: ToolFn, cwd: () => string | undefined): ToolFn {
  return async (...args: unknown[]) => {
    const result = await fn(...args);
    return clipMcpToolResult(result as { content?: Array<{ type?: string; text?: string }> }, cwd());
  };
}

function wrapRegistrar<T extends ToolFn>(orig: T, cwd: () => string | undefined): T {
  return ((...args: unknown[]) => {
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      args[last] = wrapToolCallback(args[last] as ToolFn, cwd);
    }
    return orig(...args);
  }) as T;
}

/** Patch `server.tool` (and `registerTool` when present) so results are clipped. */
export function wrapMcpToolResults(
  server: McpServer,
  cwd: () => string | undefined = () => process.cwd(),
): McpServer {
  const rec = server as McpServer & { tool: ToolFn; registerTool?: ToolFn };
  rec.tool = wrapRegistrar(rec.tool.bind(server), cwd);
  if (typeof rec.registerTool === 'function') {
    rec.registerTool = wrapRegistrar(rec.registerTool.bind(server), cwd);
  }
  return server;
}

export function createClippedMcpServer(): McpServer {
  return wrapMcpToolResults(
    new McpServer({
      name: 'sideboard',
      version: '0.1.0',
    }),
  );
}
