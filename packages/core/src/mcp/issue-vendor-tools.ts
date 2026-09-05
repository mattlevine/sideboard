import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  type AppSettings,
} from '../store/app-settings.js';
import { registerAbleTimeTools } from './abletime-tools.js';
import { registerLinearTools } from './linear-tools.js';

/**
 * Register Linear / AbleTime MCP tools only when that Account connection exists.
 * `list_issues` stays registered either way and falls back to GitHub.
 */
export function registerConnectedIssueVendorTools(
  server: McpServer,
  settings: AppSettings = loadAppSettings(),
): void {
  if (isLinearConnected(settings)) registerLinearTools(server);
  if (isAbleTimeConnected(settings)) registerAbleTimeTools(server);
}
