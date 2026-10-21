import type { McpUiView } from '../mcp-ui/meta.js';

/** Desktop IPC for Claude MCP Apps. Kept off `IpcApi` so that file stays under the line cap. */
export interface McpUiIpc {
  /**
   * MCP App HTML for a Claude tool (`mcp__server__tool`). Null when that
   * server has no `ui://` resource. Claude talks to a loopback proxy that
   * shares this host session.
   */
  mcpUiLookup(toolName: string, threadId?: string): Promise<McpUiView | null>;
  mcpUiCallTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    threadId?: string,
  ): Promise<unknown>;
  mcpUiReadResource(server: string, uri: string, threadId?: string): Promise<unknown>;
  /** Stash `ui/update-model-context` for the next agent turn. Does not send. */
  mcpUiUpdateModelContext(threadId: string, text: string): Promise<void>;
  /** Sandboxed custom-protocol URL for an MCP App (inline scripts allowed). */
  publishMcpUiPreview(id: string, html: string, csp: string): Promise<{ url: string }>;
  clearMcpUiPreview(id: string): Promise<void>;
}
