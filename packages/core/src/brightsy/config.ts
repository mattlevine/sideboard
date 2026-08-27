import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BrightsyLocalConfig {
  access_token: string;
  refresh_token?: string;
  account_id: string;
  account_slug?: string;
  endpoint?: string;
  expires_at?: number;
  oauth_client_id?: string;
}

export function brightsyConfigPath(): string {
  const override = process.env.BRIGHTSY_CONFIG?.trim();
  if (override) return override;
  return join(homedir(), '.brightsy', 'config.json');
}

export function loadBrightsyConfig(): BrightsyLocalConfig {
  const path = brightsyConfigPath();
  if (!existsSync(path)) {
    throw new Error('Brightsy not logged in — run `brightsy login` first');
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<BrightsyLocalConfig>;
  if (!raw.access_token || !raw.account_id) {
    throw new Error('Brightsy config incomplete — run `brightsy login`');
  }
  return raw as BrightsyLocalConfig;
}

export function saveBrightsyConfig(cfg: BrightsyLocalConfig): void {
  writeFileSync(brightsyConfigPath(), `${JSON.stringify(cfg, null, 2)}\n`, {
    mode: 0o600,
  });
}
