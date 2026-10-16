import { ipcMain } from 'electron';
import { getMcpUiHost } from '@sideboard-ai/core';

/** MCP Apps host for tools Claude called (`mcp__server__tool`). */
export function registerMcpUiIpc(): void {
  const host = getMcpUiHost();

  ipcMain.handle('mcpUi:lookup', async (_e, toolName: unknown) => {
    if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null;
    return host.viewForClaudeTool(toolName);
  });

  ipcMain.handle('mcpUi:callTool', async (_e, server: unknown, tool: unknown, args: unknown) => {
    if (typeof server !== 'string' || typeof tool !== 'string') {
      throw new Error('invalid mcp-ui tool call');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('invalid mcp-ui tool arguments');
    }
    return host.callTool(server, tool, args as Record<string, unknown>);
  });

  ipcMain.handle('mcpUi:readResource', async (_e, server: unknown, uri: unknown) => {
    if (typeof server !== 'string' || typeof uri !== 'string' || !uri.trim()) {
      throw new Error('invalid mcp-ui resource read');
    }
    return host.readResource(server, uri);
  });
}
