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

export function mcpAuthWarnings(servers: McpServerStatus[]): string[] {
  const needing = servers.filter((s) => s.needsAuth).map((s) => s.name);
  if (needing.length === 0) return [];
  return [
    `MCP needs login: ${needing.join(', ')}. Run: claude mcp login "<name>"`,
  ];
}
