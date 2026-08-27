import { join } from 'node:path';
import { appDataDir } from './paths.js';
import { readSecureJson, writeSecureJson } from './secure-file.js';

export interface SettingsSecretVault {
  linearApiKey?: string;
  linearAccessToken?: string;
  linearRefreshToken?: string;
  linearClientSecret?: string;
  slackClientSecret?: string;
  slackAppToken?: string;
  githubPat?: string;
  abletimeAccessToken?: string;
  environment?: Record<string, string>;
}

export function secretVaultPath(): string {
  return join(appDataDir(), 'secrets.json');
}

export function loadSecretVault(): SettingsSecretVault {
  const parsed = readSecureJson<SettingsSecretVault>(secretVaultPath());
  if (!parsed || typeof parsed !== 'object') return {};
  return normalizeVault(parsed);
}

export function saveSecretVault(vault: SettingsSecretVault): void {
  writeSecureJson(secretVaultPath(), normalizeVault(vault));
}

function normalizeVault(raw: SettingsSecretVault): SettingsSecretVault {
  const out: SettingsSecretVault = {};
  if (typeof raw.linearApiKey === 'string' && raw.linearApiKey.trim()) {
    out.linearApiKey = raw.linearApiKey.trim();
  }
  if (typeof raw.linearAccessToken === 'string' && raw.linearAccessToken.trim()) {
    out.linearAccessToken = raw.linearAccessToken.trim();
  }
  if (typeof raw.linearRefreshToken === 'string' && raw.linearRefreshToken.trim()) {
    out.linearRefreshToken = raw.linearRefreshToken.trim();
  }
  if (typeof raw.linearClientSecret === 'string' && raw.linearClientSecret.trim()) {
    out.linearClientSecret = raw.linearClientSecret.trim();
  }
  if (typeof raw.slackClientSecret === 'string' && raw.slackClientSecret.trim()) {
    out.slackClientSecret = raw.slackClientSecret.trim();
  }
  if (typeof raw.slackAppToken === 'string' && raw.slackAppToken.trim()) {
    out.slackAppToken = raw.slackAppToken.trim();
  }
  if (typeof raw.githubPat === 'string' && raw.githubPat.trim()) {
    out.githubPat = raw.githubPat.trim();
  }
  if (typeof raw.abletimeAccessToken === 'string' && raw.abletimeAccessToken.trim()) {
    out.abletimeAccessToken = raw.abletimeAccessToken.trim();
  }
  if (raw.environment && typeof raw.environment === 'object') {
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.environment)) {
      const k = key.trim();
      const v = typeof value === 'string' ? value.trim() : '';
      if (k && v) environment[k] = v;
    }
    if (Object.keys(environment).length > 0) out.environment = environment;
  }
  return out;
}
