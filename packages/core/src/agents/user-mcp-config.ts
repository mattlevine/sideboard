import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import {
  resolveSideboardMcpServer,
  type InjectedMcpServer,
} from './injected-mcp.js';

export type UserMcpStdioLaunch = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export function userCursorMcpConfigPath(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

/** Claude Code user MCP file (`claude mcp add --scope user`). */
export function userClaudeMcpConfigPath(): string {
  return join(homedir(), '.claude.json');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function stripElectronSpawnEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.ELECTRON_RUN_AS_NODE;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Merge a `sideboard` stdio server into an mcp.json-shaped document. Does not clobber other servers. */
export function mergeSideboardIntoMcpServersJson(
  existing: unknown,
  sideboard: UserMcpStdioLaunch,
): Record<string, unknown> {
  const root = asObject(existing);
  const servers = asObject(root.mcpServers);
  const env = stripElectronSpawnEnv(sideboard.env);
  servers.sideboard = {
    type: 'stdio',
    command: sideboard.command,
    ...(sideboard.args && sideboard.args.length > 0 ? { args: sideboard.args } : {}),
    ...(env ? { env } : {}),
  };
  return { ...root, mcpServers: servers };
}

export function writeMergedMcpServersJson(
  configPath: string,
  sideboard: UserMcpStdioLaunch,
): void {
  let existing: unknown = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    } catch {
      existing = {};
    }
  }
  const next = mergeSideboardIntoMcpServersJson(existing, sideboard);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function launchFromResolved(server: InjectedMcpServer): UserMcpStdioLaunch {
  return {
    command: server.command,
    args: server.args,
    env: {
      ...(server.env ?? {}),
      SIDEBOARD_APP_DATA: appDataDir(),
    },
  };
}

/**
 * Packaged Sideboard.app: upsert the same absolute bundled `node` + extraResources MCP
 * into Cursor IDE (always) and Claude Code (only if ~/.claude.json already exists).
 * Codex is documented only — do not rewrite ~/.codex/config.toml.
 */
export async function registerPackagedUserMcpClients(): Promise<{
  cursor: string;
  claude?: string;
}> {
  const launch = launchFromResolved(await resolveSideboardMcpServer());
  const cursor = userCursorMcpConfigPath();
  writeMergedMcpServersJson(cursor, launch);

  const claude = userClaudeMcpConfigPath();
  if (existsSync(claude)) {
    writeMergedMcpServersJson(claude, launch);
    return { cursor, claude };
  }
  return { cursor };
}
