import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  COMPUTER_USE_DESCRIPTION,
  macosComputerUseRunner,
  performComputerUse,
} from '../computer-use/computer-use.js';
import { computerUseEnabled } from '../store/app-settings.js';
import { mcpJson } from './issue-list.js';

/** Worktree MCP `computer_use`. Omitted when Agent RPC owns the pilot tools. */
export function registerComputerUseTool(server: McpServer, catalog: Set<string>): void {
  if (!catalog.has('computer_use')) return;
  server.tool(
    'computer_use',
    COMPUTER_USE_DESCRIPTION,
    {
      action: z
        .enum(['screenshot', 'click', 'type', 'key', 'scroll'])
        .describe('screenshot, click, type, key, or scroll'),
      x: z.number().optional().describe('Screen x in points, not PNG pixels, for click and scroll'),
      y: z.number().optional().describe('Screen y in points, not PNG pixels, for click and scroll'),
      text: z.string().optional().describe('Text to type'),
      key: z
        .string()
        .optional()
        .describe('One key: return, tab, escape, arrows, delete, or one character'),
      modifiers: z.array(z.string()).optional().describe('command, shift, option, control'),
      dx: z.number().optional().describe('Horizontal scroll in points. Positive is right'),
      dy: z.number().optional().describe('Vertical scroll in points. Positive is down'),
    },
    async (args) => {
      const result = await performComputerUse({
        enabled: computerUseEnabled(),
        cwd: process.cwd(),
        input: args,
        runner: macosComputerUseRunner,
      });
      return mcpJson(result);
    },
  );
}
