import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import { loadBrightsyConfig } from '../brightsy/config.js';
import {
  brightsyMcpServerName,
  ensureConnectedBrightsyTeamTokens,
  type ConnectedBrightsyTeam,
} from '../brightsy/connected-teams.js';

export type InjectedMcpServer = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** Claude --allowedTools entries for Sideboard MCP. */
export const SIDEBOARD_MCP_ALLOWED_TOOLS = [
  'mcp__sideboard',
  'mcp__sideboard__*',
] as const;

/** Legacy single-server allow list (CLI ~/.brightsy fallback). */
export const BRIGHTSY_MCP_ALLOWED_TOOLS = [
  'mcp__brightsy',
  'mcp__brightsy__*',
] as const;

let brightsyMcpCommandCache: { at: number; command: string | null } | null =
  null;

async function resolveBrightsyMcpCommand(): Promise<'brightsy-mcp' | 'npx'> {
  const now = Date.now();
  if (
    brightsyMcpCommandCache &&
    now - brightsyMcpCommandCache.at < 60_000 &&
    brightsyMcpCommandCache.command
  ) {
    return brightsyMcpCommandCache.command as 'brightsy-mcp' | 'npx';
  }
  const which = await run('which', ['brightsy-mcp'], { reject: false });
  const command =
    which.exitCode === 0 && which.stdout.trim() ? 'brightsy-mcp' : 'npx';
  brightsyMcpCommandCache = { at: now, command };
  return command;
}

/** True when ~/.brightsy/config.json has a usable login session. */
export function isBrightsyConnected(): boolean {
  try {
    loadBrightsyConfig();
    return true;
  } catch {
    return false;
  }
}

function mcpLaunch(
  cmd: 'brightsy-mcp' | 'npx',
  name: string,
  env?: Record<string, string>,
): InjectedMcpServer {
  if (cmd === 'brightsy-mcp') {
    return { name, command: 'brightsy-mcp', ...(env ? { env } : {}) };
  }
  return {
    name,
    command: 'npx',
    args: ['-y', '@brightsy/mcp-server'],
    ...(env ? { env } : {}),
  };
}

function teamEnv(team: ConnectedBrightsyTeam): Record<string, string> {
  const endpoint = (team.endpoint || 'https://brightsy.ai').replace(/\/$/, '');
  return {
    BRIGHTSY_API_TOKEN: team.access_token,
    BRIGHTSY_ACCOUNT_ID: team.id,
    BRIGHTSY_API_URL: endpoint,
  };
}

/** Allow-tool patterns for one or more Brightsy MCP server names. */
export function brightsyMcpAllowedTools(serverNames: string[]): string[] {
  const out: string[] = [];
  for (const name of serverNames) {
    out.push(`mcp__${name}`, `mcp__${name}__*`);
  }
  return out;
}

export async function buildInjectedMcpServers(opts: {
  includeSideboard?: boolean;
  includeBrightsy?: boolean;
}): Promise<InjectedMcpServer[]> {
  const servers: InjectedMcpServer[] = [];

  if (opts.includeSideboard) {
    servers.push({
      name: 'sideboard',
      command: 'sideboard',
      args: ['mcp'],
    });
  }

  if (opts.includeBrightsy && isBrightsyConnected()) {
    const cmd = await resolveBrightsyMcpCommand();
    const teams = await ensureConnectedBrightsyTeamTokens();
    if (teams.length > 0) {
      const used = new Set<string>();
      for (const team of teams) {
        let name = brightsyMcpServerName(team.slug);
        if (used.has(name)) name = `${name}_${team.id.slice(0, 8)}`;
        used.add(name);
        servers.push(mcpLaunch(cmd, name, teamEnv(team)));
      }
    } else {
      // Fallback: single MCP from ~/.brightsy until teams are connected in Sideboard.
      servers.push(mcpLaunch(cmd, 'brightsy'));
    }
  }

  return servers;
}

/** Persist injected MCP servers to a temp Claude `--mcp-config` JSON. */
export function writeMcpServersConfig(servers: InjectedMcpServer[]): string | null {
  if (servers.length === 0) return null;

  const mcpServers: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  > = {};
  for (const s of servers) {
    mcpServers[s.name] = {
      command: s.command,
      ...(s.args ? { args: s.args } : {}),
      ...(s.env ? { env: s.env } : {}),
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'sideboard-mcp-'));
  const cfgPath = join(dir, 'mcp.json');
  writeFileSync(cfgPath, JSON.stringify({ mcpServers }, null, 2));
  return cfgPath;
}

/**
 * Write a temp Claude `--mcp-config` JSON for injected Sideboard / Brightsy MCP.
 * Returns null when there is nothing to inject.
 */
export async function writeInjectedMcpConfig(opts: {
  includeSideboard?: boolean;
  includeBrightsy?: boolean;
}): Promise<string | null> {
  return writeMcpServersConfig(await buildInjectedMcpServers(opts));
}

/** @deprecated Use writeInjectedMcpConfig({ includeSideboard: true }) */
export function writeSideboardMcpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-orch-mcp-'));
  const cfgPath = join(dir, 'mcp.json');
  writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        mcpServers: {
          sideboard: { command: 'sideboard', args: ['mcp'] },
        },
      },
      null,
      2,
    ),
  );
  return cfgPath;
}
