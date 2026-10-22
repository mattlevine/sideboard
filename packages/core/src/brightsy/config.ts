import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BrightsyLocalConfig {
  access_token: string;
  refresh_token?: string;
  account_id: string;
  account_slug?: string;
  endpoint?: string;
  expires_at?: number;
  oauth_client_id?: string;
}

/** CLI / MCP layout is `~/.brightsy/config.json`. Honor a file or the directory. */
export function resolveBrightsyConfigFile(path: string): string {
  try {
    if (existsSync(path) && statSync(path).isDirectory()) {
      return join(path, 'config.json');
    }
  } catch {
    // Missing path still means "write config.json here" when it already ends in that name.
  }
  return path;
}

export function brightsyConfigPath(): string {
  const override = process.env.BRIGHTSY_CONFIG?.trim();
  const raw = override || join(homedir(), '.brightsy', 'config.json');
  return resolveBrightsyConfigFile(raw);
}

export function loadBrightsyConfig(): BrightsyLocalConfig {
  const path = brightsyConfigPath();
  if (!existsSync(path)) {
    throw new Error('Brightsy not logged in — run `brightsy login` first');
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as NodeJS.ErrnoException).code)
        : '';
    if (code === 'EISDIR') {
      throw new Error(
        `Brightsy config is a directory (${path}) — expected ~/.brightsy/config.json`,
      );
    }
    throw err;
  }
  const raw = JSON.parse(text) as Partial<BrightsyLocalConfig>;
  if (!raw.access_token || !raw.account_id) {
    throw new Error('Brightsy config incomplete — run `brightsy login`');
  }
  return raw as BrightsyLocalConfig;
}

export function saveBrightsyConfig(cfg: BrightsyLocalConfig): void {
  const path = brightsyConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, {
    mode: 0o600,
  });
}
