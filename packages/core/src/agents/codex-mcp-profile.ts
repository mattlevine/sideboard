import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Env keys that must not appear on the Codex argv (process list / shell history). */
export function isCodexSecretEnvKey(key: string): boolean {
  return /token|secret|password|credential|oauth|api_key|_key$/i.test(key);
}

function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function secretEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const out = { ...env };
  delete out.ELECTRON_RUN_AS_NODE;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Secret MCP env goes in `$CODEX_HOME/<profile>.config.toml` (mode 0600) and is
 * selected with `codex exec -p`. Caller deletes `file` after the turn.
 */
export function writeCodexMcpSecretProfile(
  servers: Array<{ name: string; env?: Record<string, string> }>,
): { profile: string; file: string } | null {
  const blocks: string[] = [];
  for (const s of servers) {
    const env = secretEnv(s.env);
    if (!env) continue;
    const secrets = Object.entries(env).filter(([key]) => isCodexSecretEnvKey(key));
    if (secrets.length === 0) continue;
    const lines = [`[mcp_servers.${s.name}.env]`];
    for (const [key, value] of secrets) lines.push(`${key} = ${tomlBasicString(value)}`);
    blocks.push(lines.join('\n'));
  }
  if (blocks.length === 0) return null;
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const profile = `sideboard-${randomBytes(8).toString('hex')}`;
  const file = join(home, `${profile}.config.toml`);
  writeFileSync(file, `${blocks.join('\n\n')}\n`, { mode: 0o600 });
  return { profile, file };
}
