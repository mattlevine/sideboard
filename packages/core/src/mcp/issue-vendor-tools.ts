import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  type AppSettings,
} from '../store/app-settings.js';
import { registerAbleTimeTools } from './abletime-tools.js';
import { registerGithubIssueTools } from './github-tools.js';
import { registerLinearTools } from './linear-tools.js';

/**
 * Register issue-tracker MCP tools for the connected Account sources.
 * GitHub Issues (via `gh`) is always available. Linear / AbleTime only when
 * that Settings → Issues connection exists. `list_issues` stays separate.
 */
export function registerConnectedIssueVendorTools(
  server: McpServer,
  settings: AppSettings = loadAppSettings(),
): void {
  registerGithubIssueTools(server);
  if (isLinearConnected(settings)) registerLinearTools(server);
  if (isAbleTimeConnected(settings)) registerAbleTimeTools(server);
}
