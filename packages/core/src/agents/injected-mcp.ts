import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../git/run.js';
import { loadBrightsyConfig } from '../brightsy/config.js';
import {
  brightsyMcpServerName,
  ensureConnectedBrightsyTeamTokens,
  type ConnectedBrightsyTeam,
} from '../brightsy/connected-teams.js';
import { resolveNodeLaunch } from './node-launch.js';

export type InjectedMcpServer = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** Claude --allowedTools entries for Sideboard MCP (full fleet). */
export const SIDEBOARD_MCP_ALLOWED_TOOLS = [
  'mcp__sideboard',
  'mcp__sideboard__*',
] as const;

/**
 * Worktree Claude turns: only auto-approve present_* UI tools
 * (not fleet control). Sideboard MCP is still injected so the tools are listed;
 * other sideboard tools remain permission-gated.
 */
export const SIDEBOARD_ARTIFACT_MCP_ALLOWED_TOOLS = [
  'mcp__sideboard__present_artifact',
  'mcp__sideboard__present_schema',
  'mcp__sideboard__present_files',
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

/**
 * Directory of the compiled @sideboard-ai/core package (dist/).
 * Electron main loads the CJS build where `import.meta.url` is empty — prefer __dirname.
 */
function corePackageDir(): string {
  // eslint-disable-next-line camelcase
  const cjsDir = typeof __dirname !== 'undefined' ? __dirname : '';
  if (cjsDir) return cjsDir;
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.length > 0) {
      return dirname(fileURLToPath(url));
    }
  } catch {
    // ignore
  }
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    return dirname(req.resolve('@sideboard-ai/core'));
  } catch {
    return process.cwd();
  }
}

/**
 * Locate a JS entry that can start Sideboard MCP.
 * Electron GUI PATH often lacks a global `sideboard` binary — prefer absolute paths.
 */
export function findSideboardMcpJsEntry(): string | null {
  const override = process.env.SIDEBOARD_MCP_ENTRY?.trim() || process.env.SIDEBOARD_CLI?.trim();
  if (override && existsSync(override)) return override;

  let dir = corePackageDir();
  for (let i = 0; i < 10; i++) {
    const candidates = [
      join(dir, 'mcp/run-stdio.js'),
      join(dir, 'mcp/run-stdio.cjs'),
      join(dir, 'dist/mcp/run-stdio.js'),
      join(dir, 'dist/mcp/run-stdio.cjs'),
      join(dir, 'packages/core/dist/mcp/run-stdio.js'),
      join(dir, 'packages/cli/dist/index.js'),
      join(dir, 'cli/dist/index.js'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve how Claude should spawn the Sideboard MCP stdio server. */
export async function resolveSideboardMcpServer(): Promise<InjectedMcpServer> {
  // Prefer the MCP bundled with this @sideboard-ai/core install (Electron / monorepo).
  // A global `sideboard` on PATH is often an older npm publish and will miss new tools
  // like present_artifact.
  const entry = findSideboardMcpJsEntry();
  if (entry) {
    const isCli = /[/\\]cli[/\\]dist[/\\]index\.js$/.test(entry);
    const scriptArgs = isCli ? [entry, 'mcp'] : [entry];
    // System `node` cannot read Electron app.asar — use Electron-as-Node there.
    const launch = await resolveNodeLaunch(entry);
    return {
      name: 'sideboard',
      command: launch.file,
      args: scriptArgs,
      ...(Object.keys(launch.env).length > 0 ? { env: launch.env } : {}),
    };
  }

  const which = await run('which', ['sideboard'], { reject: false });
  if (which.exitCode === 0 && which.stdout.trim()) {
    return { name: 'sideboard', command: which.stdout.trim(), args: ['mcp'] };
  }

  // Last resort: bare binary name (fails clearly if still not on PATH).
  return { name: 'sideboard', command: 'sideboard', args: ['mcp'] };
}

export async function buildInjectedMcpServers(opts: {
  includeSideboard?: boolean;
  includeBrightsy?: boolean;
}): Promise<InjectedMcpServer[]> {
  const servers: InjectedMcpServer[] = [];

  if (opts.includeSideboard) {
    servers.push(await resolveSideboardMcpServer());
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

/** Shape expected by `@cursor/sdk` `Agent.create` / `resume` / `send` mcpServers. */
export type CursorMcpServers = Record<
  string,
  {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }
>;

/** Convert injected MCP launches into Cursor SDK `mcpServers` map. */
export function toCursorMcpServers(servers: InjectedMcpServer[]): CursorMcpServers {
  const out: CursorMcpServers = {};
  for (const s of servers) {
    out[s.name] = {
      command: s.command,
      ...(s.args ? { args: s.args } : {}),
      ...(s.env ? { env: s.env } : {}),
    };
  }
  return out;
}

/**
 * Codex CLI `-c key=value` overrides for mcp_servers (merged over ~/.codex/config.toml).
 * @see https://developers.openai.com/codex/mcp
 */
export function toCodexMcpConfigArgs(servers: InjectedMcpServer[]): string[] {
  const args: string[] = [];
  for (const s of servers) {
    const prefix = `mcp_servers.${s.name}`;
    args.push('-c', `${prefix}.command=${JSON.stringify(s.command)}`);
    if (s.args?.length) {
      args.push('-c', `${prefix}.args=${JSON.stringify(s.args)}`);
    }
    if (s.env) {
      for (const [key, value] of Object.entries(s.env)) {
        args.push('-c', `${prefix}.env.${key}=${JSON.stringify(value)}`);
      }
    }
  }
  return args;
}

/**
 * OpenCode `OPENCODE_CONFIG_CONTENT` JSON fragment (merges over project/global config).
 * Uses the v1 `mcp.<name>` shape (`type` + `command` array + `enabled`) used by current CLI.
 */
export function toOpencodeMcpConfigContent(servers: InjectedMcpServer[]): string {
  const mcp: Record<
    string,
    {
      type: 'local';
      command: string[];
      enabled: boolean;
      environment?: Record<string, string>;
    }
  > = {};
  for (const s of servers) {
    mcp[s.name] = {
      type: 'local',
      command: [s.command, ...(s.args ?? [])],
      enabled: true,
      ...(s.env && Object.keys(s.env).length > 0 ? { environment: s.env } : {}),
    };
  }
  return JSON.stringify({ mcp });
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
  const entry = findSideboardMcpJsEntry();
  const sideboard = entry
    ? {
        command: 'node',
        args: /[/\\]cli[/\\]dist[/\\]index\.js$/.test(entry)
          ? [entry, 'mcp']
          : [entry],
      }
    : { command: 'sideboard', args: ['mcp'] };
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-orch-mcp-'));
  const cfgPath = join(dir, 'mcp.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({ mcpServers: { sideboard } }, null, 2),
  );
  return cfgPath;
}
