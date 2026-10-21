import { ipcMain } from 'electron';
import { getMcpUiHost, readThread, stashMcpAppModelContext } from '@sideboard-ai/core';

function projectDirsFor(threadId: unknown): string[] | undefined {
  if (typeof threadId !== 'string' || !threadId.trim()) return undefined;
  const thread = readThread(threadId.trim());
  if (!thread) return undefined;
  return [thread.repoPath, thread.worktreePath].filter((path) => path.trim());
}

/** MCP Apps host for tools Claude called (`mcp__server__tool`). */
export function registerMcpUiIpc(): void {
  const host = getMcpUiHost();

  ipcMain.handle('mcpUi:lookup', async (_e, toolName: unknown, threadId: unknown) => {
    if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null;
    return host.viewForClaudeTool(toolName, projectDirsFor(threadId));
  });

  ipcMain.handle(
    'mcpUi:callTool',
    async (_e, server: unknown, tool: unknown, args: unknown, threadId: unknown) => {
      if (typeof server !== 'string' || typeof tool !== 'string') {
        throw new Error('invalid mcp-ui tool call');
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new Error('invalid mcp-ui tool arguments');
      }
      return host.callTool(server, tool, args as Record<string, unknown>, projectDirsFor(threadId));
    },
  );

  ipcMain.handle('mcpUi:readResource', async (_e, server: unknown, uri: unknown, threadId: unknown) => {
    if (typeof server !== 'string' || typeof uri !== 'string' || !uri.trim()) {
      throw new Error('invalid mcp-ui resource read');
    }
    return host.readResource(server, uri, projectDirsFor(threadId));
  });

  ipcMain.handle('mcpUi:updateModelContext', async (_e, threadId: unknown, text: unknown) => {
    if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('invalid mcp-ui thread');
    if (typeof text !== 'string' || !text.trim()) throw new Error('invalid mcp-ui context');
    const thread = readThread(threadId.trim());
    if (!thread || thread.agent !== 'claude') throw new Error('MCP App context needs a Claude chat');
    stashMcpAppModelContext(thread.id, text);
  });
}
