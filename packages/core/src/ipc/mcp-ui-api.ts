import type { McpUiView } from '../mcp-ui/meta.js';

/** Desktop IPC for Claude MCP Apps. Kept off `IpcApi` so that file stays under the line cap. */
export interface McpUiIpc {
  /**
   * MCP App HTML for a Claude tool (`mcp__server__tool`). Null when that
   * server has no `ui://` resource. The desktop opens its own MCP connection;
   * Claude Code only returns the text result.
   */
  mcpUiLookup(toolName: string): Promise<McpUiView | null>;
  mcpUiCallTool(server: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  mcpUiReadResource(server: string, uri: string): Promise<unknown>;
  /** Sandboxed custom-protocol URL for an MCP App (inline scripts allowed). */
  publishMcpUiPreview(id: string, html: string, csp: string): Promise<{ url: string }>;
  clearMcpUiPreview(id: string): Promise<void>;
}
