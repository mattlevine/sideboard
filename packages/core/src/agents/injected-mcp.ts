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
import { SIDEBOARD_MCP_PROFILE_ENV } from '../mcp/profile.js';
import { loadAppSettings } from '../store/app-settings.js';
import { appDataDir } from '../store/paths.js';
import type { Thread, ThreadMessage } from '../types/thread.js';
import {
  applyAgentRunnerHeapEnv,
  applyNodeLaunch,
  isAsarPath,
  resolveNodeLaunch,
} from './node-launch.js';
import { packagedMcpStdioPath } from './packaged-runtime.js';
import {
  isElectronLikeCommand,
  unwrapStrippedElectronLaunch,
} from '../hook/nested-electron-env.js';
import { mergeAgentGitAuthEnv, resolveAgentGitAuthEnv } from '../git/git-auth-mode.js';

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
 * Worktree Claude turns: auto-approve the UI tools that the worktree MCP
 * profile actually registers (present_* / ask_user). Slack/Linear/list_* are
 * orchestration-only so they stay out of the cached tools prefix.
 */
export const SIDEBOARD_ARTIFACT_MCP_ALLOWED_TOOLS = [
  'mcp__sideboard__present_artifact',
  'mcp__sideboard__present_schema',
  'mcp__sideboard__present_files',
  'mcp__sideboard__ask_user',
  'mcp__sideboard__present_plan',
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

const BRIGHTSY_WORD = /(?<![a-z0-9_-])brightsy(?![a-z0-9_-])/i;

/** True when the user explicitly named Brightsy (e.g. "use Brightsy to …"). */
export function promptMentionsBrightsy(text: string | null | undefined): boolean {
  return BRIGHTSY_WORD.test(text ?? '');
}

function isBrightsyMcpToolName(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'brightsy' || n.startsWith('mcp__brightsy') || n.startsWith('brightsy_');
}

function toolInputUsesBrightsyDatasource(
  input: Record<string, unknown> | undefined,
): boolean {
  const ds = input?.datasource;
  return typeof ds === 'string' && ds.toLowerCase() === 'brightsy';
}

function messageUsedBrightsyMcp(msg: ThreadMessage): boolean {
  if (msg.role === 'user' && promptMentionsBrightsy(msg.text)) return true;
  for (const part of msg.parts ?? []) {
    if (part.type !== 'tool') continue;
    if (isBrightsyMcpToolName(part.name)) return true;
    if (
      /present_(schema|files)$/i.test(part.name) &&
      toolInputUsesBrightsyDatasource(part.input)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Worktree turns only inject Brightsy MCP when the user asked for it (or this
 * thread already used it). Do not scan the assembled agent prompt — the
 * artifact reminder always mentions Brightsy.
 */
export function threadRequestsBrightsyMcp(
  thread: Pick<Thread, 'messages'> | null | undefined,
): boolean {
  return (thread?.messages ?? []).some(messageUsedBrightsyMcp);
}

/**
 * Orchestration always gets Brightsy MCP when logged in. Worktree coding turns
 * get it when Settings → “Inject Brightsy MCP on worktree agents” is on, or
 * after “use Brightsy …” / a prior Brightsy tool / CMS pane.
 */
export function shouldInjectBrightsyMcp(
  thread: Pick<Thread, 'messages'> | null | undefined,
  opts?: {
    orchestrator?: boolean;
    connected?: boolean;
    alwaysOnWorktree?: boolean;
  },
): boolean {
  if (!(opts?.connected ?? isBrightsyConnected())) return false;
  if (opts?.orchestrator) return true;
  const alwaysOn =
    opts?.alwaysOnWorktree ??
    Boolean(loadAppSettings().brightsy?.injectWorktreeMcp);
  if (alwaysOn) return true;
  return threadRequestsBrightsyMcp(thread);
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
    ...(team.refresh_token ? { BRIGHTSY_REFRESH_TOKEN: team.refresh_token } : {}),
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

  // Packaged extraResources copy is on a real filesystem — bundled official
  // Node (or system `node`) can exec it. The asar duplicate needs
  // Electron-as-Node, which Cursor's local agent then reports as a dead MCP.
  const packaged = packagedMcpStdioPath();
  if (packaged) return packaged;

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
      // System `node` cannot read app.asar. Skip archive paths so we fall
      // through to PATH `sideboard mcp` instead of Electron-as-Node.
      if (existsSync(p) && !isAsarPath(p)) return p;
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
    const launch = applyNodeLaunch(await resolveNodeLaunch(entry), scriptArgs);
    // MCP is the CLI under real Node. Never Sideboard.app / Electron-as-Node.
    if (
      launch.file !== '/bin/sh' &&
      !isElectronLikeCommand(launch.file)
    ) {
      return {
        name: 'sideboard',
        command: launch.file,
        args: launch.args,
        ...(Object.keys(launch.env).length > 0 ? { env: launch.env } : {}),
      };
    }
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
  /**
   * When set (orchestration turns), Sideboard MCP inherits this as
   * SIDEBOARD_ORCHESTRATOR_THREAD_ID so create_thread can default/fix
   * parentThreadId even if the agent hallucinates a stale id.
   */
  orchestratorThreadId?: string | null;
}): Promise<InjectedMcpServer[]> {
  const servers: InjectedMcpServer[] = [];

  if (opts.includeSideboard) {
    const sideboard = await resolveSideboardMcpServer();
    // Always pin MCP to the same app-data dir as the host (desktop `pnpm dev`
    // uses `.sideboard/dev-app-data`). Without this, Codex MCP often starts with
    // a stripped env and writes to ~/Library/.../sideboard — so real desktop
    // parentThreadIds look "missing" and children vanish from the UI.
    const orchId = opts.orchestratorThreadId?.trim();
    const profile = orchId ? 'orchestration' : 'worktree';
    sideboard.env = {
      ...(sideboard.env ?? {}),
      SIDEBOARD_APP_DATA: appDataDir(),
      [SIDEBOARD_MCP_PROFILE_ENV]: profile,
    };
    if (orchId) {
      sideboard.env.SIDEBOARD_ORCHESTRATOR_THREAD_ID = orchId;
    }
    // Cursor (and some CLIs) spawn MCP with this env only. GitHub auth is a
    // warmed credential store + GH_CONFIG_DIR — never GH_TOKEN in MCP env.
    try {
      mergeAgentGitAuthEnv(
        sideboard.env,
        await resolveAgentGitAuthEnv(sideboard.env),
      );
    } catch {
      /* best-effort */
    }
    applyAgentRunnerHeapEnv(sideboard.env);
    servers.push(sideboard);
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
    type: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }
>;

/**
 * Cursor's local agent is Electron. MCP `command` must be real `node` (or
 * `sideboard`), never Sideboard.app. Unwrap leftover `/bin/sh` Electron-as-Node
 * launches so callers see the inner argv — do not hide Electron behind a
 * wrapper script.
 */
function cursorSafeMcpLaunch(
  command: string,
  args: string[] | undefined,
): { command: string; args?: string[] } {
  if (process.platform === 'win32') {
    return args && args.length > 0 ? { command, args } : { command };
  }

  const unwrapped = unwrapStrippedElectronLaunch(command, args);
  const file = unwrapped?.file ?? command;
  const fileArgs = unwrapped?.args ?? args ?? [];
  return fileArgs.length > 0 ? { command: file, args: fileArgs } : { command: file };
}

/** Drop RUN_AS_NODE from MCP spawn env. Cursor (and any Electron host) would
 * treat that as nested Electron-as-Node; other CLIs do not need it in env
 * because {@link applyNodeLaunch} already puts it in the `/bin/sh` wrapper. */
function mcpSpawnEnv(
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out = { ...env };
  delete out.ELECTRON_RUN_AS_NODE;
  delete out.ELECTRON_RUN_AS_NODE;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Convert injected MCP launches into Cursor SDK `mcpServers` map. */
export function toCursorMcpServers(servers: InjectedMcpServer[]): CursorMcpServers {
  const out: CursorMcpServers = {};
  for (const s of servers) {
    const env = mcpSpawnEnv(s.env);
    const launch = cursorSafeMcpLaunch(s.command, s.args);
    out[s.name] = {
      type: 'stdio',
      command: launch.command,
      ...(launch.args && launch.args.length > 0 ? { args: launch.args } : {}),
      ...(env ? { env } : {}),
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
    const env = mcpSpawnEnv(s.env);
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        args.push('-c', `${prefix}.env.${key}=${JSON.stringify(value)}`);
      }
    }
    // Shell approval_policy=never does not cover MCP; without this, headless
    // exec often cancels present_* / other Sideboard tools as "user cancelled".
    args.push('-c', `${prefix}.default_tools_approval_mode=${JSON.stringify('approve')}`);
    // create_thread does git fetch + detect; default 60s is tight under load.
    args.push('-c', `${prefix}.tool_timeout_sec=300`);
    args.push('-c', `${prefix}.startup_timeout_sec=30`);
  }
  return args;
}

/**
 * OpenCode `OPENCODE_CONFIG_CONTENT` JSON fragment (merges over project/global config).
 * Uses the v1 `mcp.<name>` shape (`type` + `command` array + `enabled`) used by current CLI.
 */
export function toOpencodeMcpConfigContent(
  servers: InjectedMcpServer[],
  opts?: { disableNames?: string[] },
): string {
  const mcp: Record<string, Record<string, unknown>> = {};
  for (const s of servers) {
    const env = mcpSpawnEnv(s.env);
    mcp[s.name] = {
      type: 'local',
      command: [s.command, ...(s.args ?? [])],
      enabled: true,
      ...(env ? { environment: env } : {}),
    };
  }
  for (const name of opts?.disableNames ?? []) {
    const key = name.trim();
    if (!key || mcp[key]?.enabled === true) continue;
    mcp[key] = { ...mcp[key], enabled: false };
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
    const env = mcpSpawnEnv(s.env);
    mcpServers[s.name] = {
      command: s.command,
      ...(s.args ? { args: s.args } : {}),
      ...(env ? { env } : {}),
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
        env: { SIDEBOARD_APP_DATA: appDataDir() },
      }
    : {
        command: 'sideboard',
        args: ['mcp'],
        env: { SIDEBOARD_APP_DATA: appDataDir() },
      };
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-orch-mcp-'));
  const cfgPath = join(dir, 'mcp.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({ mcpServers: { sideboard } }, null, 2),
  );
  return cfgPath;
}
