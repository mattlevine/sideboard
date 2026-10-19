import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseMcpServerLaunch } from '../mcp-ui/meta.js';

/**
 * MCP servers from Claude Code plugins the user has enabled.
 * Claude names a plugin server `plugin:<name>:<server>` and its tools
 * `mcp__plugin_<name>_<server>__<tool>`. The config key uses that tool prefix
 * so `--strict-mcp-config` and the MCP App host match the transcript.
 */
export function claudePluginServerId(pluginName: string, serverName: string): string {
  return `plugin_${pluginName}_${serverName}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function listEnabledClaudePluginMcpServers(opts?: {
  home?: string;
  projectDirs?: string[];
}): Record<string, Record<string, unknown>> {
  const home = opts?.home ?? homedir();
  const pluginsRoot = claudePluginsRoot(home);
  const enabled = enabledPluginIds(home, opts?.projectDirs ?? []);
  const installed = readInstalledPlugins(join(pluginsRoot, 'installed_plugins.json'));
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, on] of enabled) {
    if (!on) continue;
    const root = installPathFor(id, installed);
    if (!root || !existsSync(root)) continue;
    const pluginName = manifestName(root) || id.split('@')[0]?.trim() || '';
    if (!pluginName) continue;
    const dataDir = join(pluginsRoot, 'data', pluginDataId(id));
    for (const [serverName, entry] of Object.entries(loadPluginMcpServers(root))) {
      const expanded = expandPluginEntry(entry, root, dataDir);
      if (!parseMcpServerLaunch(expanded)) continue;
      const key = claudePluginServerId(pluginName, serverName);
      if (!key || key === 'plugin__') continue;
      out[key] = expanded;
    }
  }
  return out;
}

function claudePluginsRoot(home: string): string {
  const override = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim();
  if (override && isAbsolute(override)) return override;
  return join(home, '.claude', 'plugins');
}

function pluginDataId(pluginId: string): string {
  return pluginId.replace(/[^A-Za-z0-9_-]/g, '-');
}

function enabledPluginIds(home: string, projectDirs: string[]): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  applyEnabled(enabled, readEnabledPlugins(join(home, '.claude', 'settings.json')));
  const dirs = [...new Set(projectDirs.map((dir) => dir.trim()).filter(Boolean))];
  for (const dir of dirs) {
    applyEnabled(enabled, readEnabledPlugins(join(dir, '.claude', 'settings.json')));
  }
  for (const dir of dirs) {
    applyEnabled(enabled, readEnabledPlugins(join(dir, '.claude', 'settings.local.json')));
  }
  return enabled;
}

function applyEnabled(into: Map<string, boolean>, next: Record<string, boolean>): void {
  for (const [id, on] of Object.entries(next)) {
    const key = id.trim();
    if (!key) continue;
    into.set(key, on);
  }
}

function readEnabledPlugins(path: string): Record<string, boolean> {
  const root = readJson(path);
  const raw = root.enabledPlugins;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true || value === false) out[id] = value;
  }
  return out;
}

function readInstalledPlugins(path: string): Record<string, { installPath?: string }[]> {
  const root = readJson(path);
  const plugins = root.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return {};
  const out: Record<string, { installPath?: string }[]> = {};
  for (const [id, value] of Object.entries(plugins as Record<string, unknown>)) {
    const rows = Array.isArray(value) ? value : [value];
    const installs: { installPath?: string }[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const installPath = (row as { installPath?: unknown }).installPath;
      installs.push({
        ...(typeof installPath === 'string' && installPath.trim()
          ? { installPath: installPath.trim() }
          : {}),
      });
    }
    if (installs.length) out[id] = installs;
  }
  return out;
}

function installPathFor(
  id: string,
  installed: Record<string, { installPath?: string }[]>,
): string | null {
  const rows = installed[id] ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const path = rows[i]?.installPath;
    if (path && existsSync(path)) return path;
  }
  return null;
}

function manifestName(root: string): string {
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
  return typeof manifest.name === 'string' ? manifest.name.trim() : '';
}

function loadPluginMcpServers(root: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  mergeServerMap(servers, serversFromFile(join(root, '.mcp.json'), root));
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
  mergeServerMap(servers, serversFromManifest(manifest.mcpServers, root));
  return servers;
}

function serversFromManifest(value: unknown, root: string): Record<string, Record<string, unknown>> {
  if (!value) return {};
  if (typeof value === 'string') return serversFromFile(resolveInside(root, value), root);
  if (Array.isArray(value)) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const item of value) {
      if (typeof item === 'string') mergeServerMap(out, serversFromFile(resolveInside(root, item), root));
      else mergeServerMap(out, serverMap(item, root));
    }
    return out;
  }
  return serverMap(value, root);
}

function serversFromFile(path: string | null, root: string): Record<string, Record<string, unknown>> {
  if (!path || !existsSync(path)) return {};
  return serverMap(readJson(path), root);
}

function serverMap(value: unknown, root: string): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const wrapped = record.mcpServers;
  const source =
    wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)
      ? (wrapped as Record<string, unknown>)
      : record;
  if (typeof wrapped === 'string') return serversFromFile(resolveInside(root, wrapped), root);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, entry] of Object.entries(source)) {
    if (!name.trim() || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (row.disabled === true) continue;
    if (typeof row.command !== 'string' && typeof row.url !== 'string') continue;
    out[name.trim()] = row;
  }
  return out;
}

function mergeServerMap(
  into: Record<string, Record<string, unknown>>,
  extra: Record<string, Record<string, unknown>>,
): void {
  for (const [name, entry] of Object.entries(extra)) into[name] = entry;
}

function expandPluginEntry(
  entry: Record<string, unknown>,
  root: string,
  dataDir: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entry };
  if (typeof next.command === 'string') next.command = expandVars(next.command, root, dataDir);
  if (Array.isArray(next.args)) {
    next.args = next.args.map((arg) => (typeof arg === 'string' ? expandVars(arg, root, dataDir) : arg));
  }
  if (typeof next.url === 'string') next.url = expandVars(next.url, root, dataDir);
  if (next.env && typeof next.env === 'object' && !Array.isArray(next.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(next.env as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = expandVars(value, root, dataDir);
    }
    env.CLAUDE_PLUGIN_ROOT = env.CLAUDE_PLUGIN_ROOT || root;
    env.CLAUDE_PLUGIN_DATA = env.CLAUDE_PLUGIN_DATA || dataDir;
    next.env = env;
  } else if (typeof next.command === 'string') {
    next.env = { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: dataDir };
  }
  if (next.headers && typeof next.headers === 'object' && !Array.isArray(next.headers)) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(next.headers as Record<string, unknown>)) {
      if (typeof value === 'string') headers[key] = expandVars(value, root, dataDir);
    }
    next.headers = headers;
  }
  return next;
}

function expandVars(value: string, root: string, dataDir: string): string {
  return value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
    .replaceAll('${CLAUDE_PLUGIN_DATA}', dataDir);
}

function resolveInside(root: string, spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed || trimmed.endsWith('.mcpb') || trimmed.endsWith('.dxt')) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  const abs = resolve(root, trimmed);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
