import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { userCursorMcpConfigPath } from './user-mcp-config.js';

/**
 * MCP names Sideboard injects on orchestration turns. User Linear / Gmail / …
 * must not join them — those HTTP connectors hang the first find-work turn.
 */
export function isInjectedOrchMcpName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'sideboard' || n === 'brightsy' || n.startsWith('brightsy_');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function listMcpNamesFromJsonMap(raw: unknown, key: 'mcpServers' | 'mcp'): string[] {
  return Object.keys(asObject(asObject(raw)[key])).filter((n) => n.trim());
}

export function listMcpNamesFromCodexToml(text: string): string[] {
  try {
    const parsed = parseToml(text) as Record<string, unknown>;
    return Object.keys(asObject(parsed.mcp_servers)).filter((n) => n.trim());
  } catch {
    return [];
  }
}

function readJsonObject(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return {};
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function userCodexConfigPaths(home = homedir()): string[] {
  return [join(home, '.codex', 'config.toml'), join(home, '.config', 'codex', 'config.toml')];
}

export function userOpencodeConfigPaths(home = homedir()): string[] {
  return [
    join(home, '.config', 'opencode', 'opencode.json'),
    join(home, '.config', 'opencode', 'opencode.jsonc'),
  ];
}

/** User MCP names that must stay off an orchestration turn (not Sideboard / Brightsy). */
export function userMcpNamesToDisable(opts: {
  injectedNames?: Iterable<string>;
  names: Iterable<string>;
}): string[] {
  const keep = new Set(
    [...(opts.injectedNames ?? [])].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || keep.has(key) || isInjectedOrchMcpName(name)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Names from ~/.codex/config.toml (and the XDG path). Does not rewrite those files. */
export function listUserCodexMcpNames(home = homedir()): string[] {
  const names: string[] = [];
  for (const path of userCodexConfigPaths(home)) {
    if (!existsSync(path)) continue;
    names.push(...listMcpNamesFromCodexToml(readText(path)));
  }
  return names;
}

/** Names from ~/.config/opencode/opencode.json. */
export function listUserOpencodeMcpNames(home = homedir()): string[] {
  const names: string[] = [];
  for (const path of userOpencodeConfigPaths(home)) {
    if (!existsSync(path)) continue;
    names.push(...listMcpNamesFromJsonMap(readJsonObject(path), 'mcp'));
  }
  return names;
}

/** Names from ~/.cursor/mcp.json (ambient user layer). */
export function listUserCursorMcpNames(home = homedir()): string[] {
  const cursorPath =
    home === homedir() ? userCursorMcpConfigPath() : join(home, '.cursor', 'mcp.json');
  if (!existsSync(cursorPath)) return [];
  return listMcpNamesFromJsonMap(readJsonObject(cursorPath), 'mcpServers');
}

export function toCodexDisableUserMcpArgs(names: string[]): string[] {
  const args: string[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
    args.push('-c', `mcp_servers.${name}.enabled=false`);
  }
  return args;
}
