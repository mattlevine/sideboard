export interface McpServerStatus {
  name: string;
  connected: boolean;
  needsAuth: boolean;
}

/**
 * Parse `claude mcp list` human output.
 * Example lines:
 *   claude.ai Brightsy Ai: https://mcp.brightsy.ai/mcp - ✔ Connected
 *   claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication
 */
export function parseMcpList(text: string): McpServerStatus[] {
  const servers: McpServerStatus[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^Checking MCP/i.test(line)) continue;
    const m = line.match(/^(.+?):\s+\S+/);
    if (!m) continue;
    const name = m[1]!.trim();
    if (!name || seen.has(name)) continue;
    const needsAuth = /Needs authentication/i.test(line);
    const connected = !needsAuth && /Connected/i.test(line);
    if (!needsAuth && !connected) continue;
    seen.add(name);
    servers.push({ name, connected, needsAuth });
  }
  return servers;
}

/**
 * Claude Code turns MCP server display names into tool-name segments by
 * replacing any character outside [A-Za-z0-9_-] with `_`.
 * e.g. "claude.ai Brightsy Ai" → "claude_ai_Brightsy_Ai"
 * Tools are then `mcp__claude_ai_Brightsy_Ai__list_agents`.
 */
export function sanitizeMcpServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Claude.ai directory connectors ("claude.ai Notion") use tool names
 * `mcp__claude_ai_<Display>__<tool>`. Desktop's "Always allow" is this server.
 */
export function isClaudeAiConnectorMcp(
  toolName: string,
  serverName?: string,
  serverSource?: string,
): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  if (serverSource === 'claudeai') return true;
  if (serverName && /^claude\.ai\b/i.test(serverName.trim())) return true;
  if (/^mcp__claude_ai_/i.test(toolName)) return true;
  const id = mcpServerIdForPermission(toolName, serverName);
  return id != null && id.startsWith('claude_ai_');
}

/**
 * Server id Claude uses in `mcp__<server>__<tool>`. The tool name wins over the
 * config key, which may still contain spaces ("claude.ai Slack").
 */
export function mcpServerIdForPermission(toolName: string, serverName?: string): string | null {
  if (toolName.startsWith('mcp__')) {
    const rest = toolName.slice('mcp__'.length);
    const split = rest.indexOf('__');
    const id = (split === -1 ? rest : rest.slice(0, split)).trim();
    if (id && id !== '*') return id;
  }
  const sanitized = sanitizeMcpServerName((serverName ?? '').trim());
  return sanitized || null;
}

/** Session rule that allows every tool on one MCP server, not one argument list. */
export function mcpServerPermissionUpdate(serverId: string): {
  type: 'addRules';
  rules: Array<{ toolName: string }>;
  behavior: 'allow';
  destination: 'session';
} {
  return {
    type: 'addRules',
    behavior: 'allow',
    destination: 'session',
    rules: [{ toolName: `mcp__${serverId}` }, { toolName: `mcp__${serverId}__*` }],
  };
}

/**
 * Allow-list entries for connected MCP servers.
 * Emit both server-level and tool-wildcard forms (no spaces — `--allowedTools`
 * splits on commas *and* spaces).
 */
export function mcpAllowTools(servers: McpServerStatus[]): string[] {
  const out: string[] = [];
  for (const s of servers) {
    if (!s.connected) continue;
    const id = sanitizeMcpServerName(s.name);
    if (!id) continue;
    out.push(`mcp__${id}`);
    out.push(`mcp__${id}__*`);
  }
  return out;
}

/** Allow-list from config-file names (no `claude mcp list` probe). */
export function mcpAllowToolsFromNames(names: Iterable<string>): string[] {
  return mcpAllowTools(
    [...names]
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name, connected: true, needsAuth: false })),
  );
}

export function mcpAuthWarnings(servers: McpServerStatus[]): string[] {
  const needing = servers.filter((s) => s.needsAuth).map((s) => s.name);
  if (needing.length === 0) return [];
  return [
    `MCP needs login: ${needing.join(', ')}. Run: claude mcp login "<name>"`,
  ];
}

/**
 * Tools Sideboard auto-approves on every Claude turn.
 * `--allowedTools` does not restrict availability — it skips permission prompts.
 * Non-interactive `-p` turns have no TTY dialog, so anything not listed here
 * (with default `acceptEdits` autonomy) is denied.
 *
 * Background Agent/Task polls need TaskOutput / TaskStop. EnterWorktree is how
 * `isolation: "worktree"` agents start. Skill is process guides.
 * AskUserQuestion is the composer picker, so it stays approved in every mode.
 */
export const BASE_ALLOWED_TOOLS = [
  'Edit',
  'Write',
  'Bash',
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
  'TaskOutput',
  'TaskStop',
  'EnterWorktree',
  'ExitWorktree',
  'Skill',
  'AskUserQuestion',
];

/**
 * `claude -p` waits this long for background Agent/Task before abandoning them.
 * Claude Code’s default is 10 minutes — too short for a coding subagent.
 */
export const CLAUDE_PRINT_BG_WAIT_CEILING_MS = 7_200_000;

/**
 * When Settings → Agents → Claude → Chrome is on, Sideboard passes `--chrome`
 * and auto-approves the Claude-in-Chrome MCP + skill.
 */
export const CLAUDE_CHROME_ALLOWED_TOOLS = [
  'mcp__claude-in-chrome',
  'mcp__claude-in-chrome__*',
  'Skill(claude-in-chrome)',
] as const;

/**
 * Claude.ai directory connector ("claude.ai PostHog").
 * `--allowedTools` skips prompts; unlisted MCP tools are denied on `-p`.
 * Include these only when Sideboard has no PostHog API key.
 */
export const CLAUDE_POSTHOG_CONNECTOR_ALLOWED_TOOLS = [
  'mcp__claude_ai_PostHog',
  'mcp__claude_ai_PostHog__*',
] as const;

