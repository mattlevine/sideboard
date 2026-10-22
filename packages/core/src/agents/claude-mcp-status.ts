import { githubAgentAuthReady } from '../git/github-agent-auth.js';
import { isLinearConnected, isPosthogConnected, loadAppSettings } from '../store/app-settings.js';

type ClaudeMcpServerStatus = {
  name: string;
  status: string;
};

type SideboardConnectorService =
  | 'github'
  | 'linear'
  | 'posthog'
  | 'vercel'
  | 'supabase'
  | 'sentry';

const SIDEBOARD_CONNECTOR_SERVICES: readonly SideboardConnectorService[] = [
  'github',
  'linear',
  'posthog',
  'vercel',
  'supabase',
  'sentry',
];

/**
 * Claude Code `system/init` lists user + claude.ai MCP servers as `mcp_servers`
 * (array or map). Paint a thinking line for Sideboard not connected, or a user
 * stdio MCP that failed. A Claude connector that duplicates a working Sideboard
 * connection is noise. Mention that connector, including `claude.ai PostHog`,
 * when that Sideboard connection is unset or the Sideboard server failed.
 * Unrelated `claude.ai` servers (Slack, Gmail) stay off the line.
 */
export function mcpStatusThinkingFromClaudeInit(
  obj: Record<string, unknown>,
): string | null {
  const raw = obj.mcp_servers ?? obj.mcpServers;
  const servers: ClaudeMcpServerStatus[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const name =
        (typeof rec.name === 'string' && rec.name.trim()) ||
        (typeof rec.server === 'string' && rec.server.trim()) ||
        '';
      const status =
        (typeof rec.status === 'string' && rec.status.trim()) ||
        (typeof rec.state === 'string' && rec.state.trim()) ||
        '';
      if (name) servers.push({ name, status: status || 'unknown' });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!name.trim()) continue;
      if (typeof value === 'string' && value.trim()) {
        servers.push({ name, status: value.trim() });
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const rec = value as Record<string, unknown>;
        const status =
          (typeof rec.status === 'string' && rec.status.trim()) ||
          (typeof rec.state === 'string' && rec.state.trim()) ||
          'unknown';
        servers.push({ name, status });
      }
    }
  }
  const coverage = claudeConnectorCoverage();
  const sideboardOk = sideboardMcpOk(servers);
  const notable = servers.filter((server) =>
    isNotableMcpInitStatus(server, sideboardOk, coverage),
  );
  if (notable.length === 0) return null;
  return `MCP: ${notable.map((s) => `${s.name} ${s.status}`).join(', ')}`;
}

function isCleanMcpConnect(status: string): boolean {
  return /^(connected|ok|ready|success)$/i.test(status.trim());
}

function isMcpAuthStatus(status: string): boolean {
  return /needs[_-]?auth|needs authentication|unauthorized|not authenticated|authrequired/i.test(
    status,
  );
}

function isSideboardMcpName(name: string): boolean {
  return /^sideboard$/i.test(name.trim()) || /^mcp__sideboard$/i.test(name.trim());
}

function isVendorClaudeAiMcpName(name: string): boolean {
  return /^claude\.ai\b/i.test(name.trim()) || /^mcp__claude_ai_/i.test(name.trim());
}

function sideboardMcpOk(servers: ClaudeMcpServerStatus[]): boolean {
  const row = servers.find((server) => isSideboardMcpName(server.name));
  return Boolean(row && isCleanMcpConnect(row.status));
}

/**
 * Official Claude connector ids that duplicate a Sideboard integration.
 * `mcp_github_github` is the GitHub plugin (`plugin:github:github`). A bare
 * user server named `linear` is not one of these.
 */
function sideboardServiceForClaudeConnector(name: string): SideboardConnectorService | null {
  const raw = name.trim();
  if (!raw || isSideboardMcpName(raw)) return null;
  const pluginLike = /^(?:plugin[:_]|mcp__plugin_|claude\.ai\s|(?:mcp__)?claude_ai_)/i.test(raw);
  const doubled = raw.match(/^mcp_([a-z0-9]+)_([a-z0-9]+)$/i);
  if (!pluginLike && !(doubled && doubled[1]!.toLowerCase() === doubled[2]!.toLowerCase())) {
    return null;
  }
  let body = raw;
  if (/^claude\.ai\s+/i.test(body)) body = body.replace(/^claude\.ai\s+/i, '');
  else if (/^(?:mcp__)?claude_ai_/i.test(body)) body = body.replace(/^(?:mcp__)?claude_ai_/i, '');
  else if (/^mcp__plugin_/i.test(body)) body = body.slice('mcp__plugin_'.length);
  else if (/^plugin_/i.test(body)) body = body.slice('plugin_'.length);
  else if (/^plugin:/i.test(body)) body = body.slice('plugin:'.length);
  else if (/^mcp_/i.test(body)) body = body.slice('mcp_'.length);
  const head = body.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0];
  if (!head || !(SIDEBOARD_CONNECTOR_SERVICES as readonly string[]).includes(head)) return null;
  return head as SideboardConnectorService;
}

function claudeConnectorCoverage(): Record<SideboardConnectorService, boolean> {
  let github = false;
  try {
    github = githubAgentAuthReady();
  } catch {
    github = false;
  }
  let linear = false;
  let posthog = false;
  let vercel = false;
  let supabase = false;
  let sentry = false;
  try {
    linear = isLinearConnected();
    posthog = isPosthogConnected();
    const integrations = loadAppSettings().integrations ?? {};
    if (integrations.githubPat?.trim()) github = true;
    vercel = Boolean(integrations.vercelToken?.trim());
    supabase = Boolean(integrations.supabaseAccessToken?.trim());
    sentry = Boolean(integrations.sentryAuthToken?.trim());
  } catch {
    /* settings unavailable — treat Sideboard connectors as unset */
  }
  return { github, linear, posthog, vercel, supabase, sentry };
}

function isNotableMcpInitStatus(
  server: ClaudeMcpServerStatus,
  sideboardOk: boolean,
  coverage: Record<SideboardConnectorService, boolean>,
): boolean {
  if (isCleanMcpConnect(server.status)) return false;
  if (isSideboardMcpName(server.name)) return true;
  if (isMcpAuthStatus(server.status)) return false;
  const service = sideboardServiceForClaudeConnector(server.name);
  if (service) return !(sideboardOk && coverage[service]);
  if (isVendorClaudeAiMcpName(server.name)) return false;
  return true;
}
