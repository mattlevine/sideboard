import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import { httpFetch } from '../http/fetch.js';
import { resolveClaudeExecutable } from '../store/app-settings.js';
import {
  parseClaudeUsagePayload,
  type ClaudePlanUsage,
} from './claude-usage.js';

export const CLAUDE_OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CLAUDE_USAGE_TTL_MS = 90_000;
export const CLAUDE_USAGE_ERROR_TTL_MS = 5 * 60_000;
export const CLAUDE_USAGE_STALE_OK_MS = 30 * 60_000;

const KEYCHAIN_SERVICES = ['Claude Code-credentials', 'Claude Code'] as const;

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type ClaudeUsageClientOpts = {
  fetch?: FetchLike;
  now?: number;
  readAccessToken?: () => Promise<string | null>;
  userAgent?: string;
  /** Skip the in-process cache (composer confirm before send). */
  force?: boolean;
  /** Isolated Claude config dir for a managed account. */
  configDir?: string;
};

let cache: { at: number; dir: string; value: ClaudePlanUsage | null } | null = null;
let errorUntil = 0;
let inflight: Promise<ClaudePlanUsage | null> | null = null;
let lastGood: { at: number; dir: string; value: ClaudePlanUsage } | null = null;
let claudeVersion: string | null = null;
let cacheDirKey = '';

function usageCacheDir(opts: ClaudeUsageClientOpts): string {
  return opts.configDir?.trim() || '';
}

function adoptCacheDir(dir: string): void {
  if (dir === cacheDirKey) return;
  cache = null;
  lastGood = null;
  errorUntil = 0;
  inflight = null;
  cacheDirKey = dir;
}

export function resetClaudeUsageCacheForTests(): void {
  cache = null;
  errorUntil = 0;
  inflight = null;
  lastGood = null;
  claudeVersion = null;
  cacheDirKey = '';
}

/** Pull an access token from Claude Code's credentials JSON — never log the result. */
export function accessTokenFromCredentialsJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('sk-ant-')) {
    const token = trimmed.split(/\s+/)[0];
    return token || null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const oauth = (
      parsed.claudeAiOauth && typeof parsed.claudeAiOauth === 'object'
        ? parsed.claudeAiOauth
        : parsed
    ) as Record<string, unknown>;
    const token = oauth.accessToken ?? oauth.access_token;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function claudeCredentialsPath(configDir?: string): string {
  const root = configDir?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(root, '.credentials.json');
}

async function readFileAccessToken(configDir?: string): Promise<string | null> {
  const path = claudeCredentialsPath(configDir);
  if (!existsSync(path)) return null;
  try {
    return accessTokenFromCredentialsJson(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readKeychainAccessToken(configDir?: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const root = configDir?.trim();
  // Claude Code 2.1+ can scope the keychain item to the config dir as account.
  const accounts = root ? [root, undefined] : [undefined];
  for (const service of KEYCHAIN_SERVICES) {
    for (const account of accounts) {
      const args = ['find-generic-password', '-s', service, '-w'];
      if (account) args.splice(3, 0, '-a', account);
      const result = await run('security', args, {
        reject: false,
        timeoutMs: 4_000,
      });
      if (result.exitCode !== 0 || !result.stdout.trim()) continue;
      const token = accessTokenFromCredentialsJson(result.stdout);
      if (token) return token;
    }
  }
  return null;
}

export async function readClaudeAccessToken(configDir?: string): Promise<string | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) return envToken;
  const fromFile = await readFileAccessToken(configDir);
  if (fromFile) return fromFile;
  return readKeychainAccessToken(configDir);
}

async function resolveClaudeUserAgent(): Promise<string> {
  if (claudeVersion) return `claude-code/${claudeVersion}`;
  try {
    const claude = resolveClaudeExecutable();
    const result = await run(claude, ['--version'], { reject: false, timeoutMs: 4_000 });
    const match = `${result.stdout}\n${result.stderr}`.match(/(\d+\.\d+\.\d+)/);
    claudeVersion = match?.[1] ?? '2.1.80';
  } catch {
    claudeVersion = '2.1.80';
  }
  return `claude-code/${claudeVersion}`;
}

function staleOk(now: number): ClaudePlanUsage | null {
  if (!lastGood) return null;
  if (now - lastGood.at > CLAUDE_USAGE_STALE_OK_MS) return null;
  return lastGood.value;
}

/** Rate-limited: keep showing the last good reading (no age cap). */
function reuseLast(): ClaudePlanUsage | null {
  return lastGood?.value ?? null;
}

/**
 * Live Claude Code plan utilization (5-hour / weekly / per-model).
 * Returns null for API-key accounts, missing login, or fetch failures.
 * Never returns tokens — percentages and reset times only.
 */
export async function getClaudePlanUsage(
  opts: ClaudeUsageClientOpts = {},
): Promise<ClaudePlanUsage | null> {
  const now = opts.now ?? Date.now();
  adoptCacheDir(usageCacheDir(opts));
  // Honor 429 / transient backoff even for composer `force` — retrying a
  // rate-limited usage URL is what hid the meter and made the 429 worse.
  if (now < errorUntil) return reuseLast() ?? staleOk(now);
  if (!opts.force) {
    if (cache && now - cache.at < CLAUDE_USAGE_TTL_MS) return cache.value;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const token = await (opts.readAccessToken ?? (() => readClaudeAccessToken(opts.configDir)))();
      if (!token) {
        cache = { at: now, dir: cacheDirKey, value: null };
        return null;
      }
      const fetchFn = opts.fetch ?? (httpFetch as FetchLike);
      const userAgent = opts.userAgent ?? (await resolveClaudeUserAgent());
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        res = await fetchFn(CLAUDE_OAUTH_USAGE_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': userAgent,
          },
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) {
        cache = { at: now, dir: cacheDirKey, value: null };
        return null;
      }
      if (res.status === 429) {
        errorUntil = now + CLAUDE_USAGE_ERROR_TTL_MS;
        const last = reuseLast();
        if (last) cache = { at: now, dir: cacheDirKey, value: last };
        return last;
      }
      if (!res.ok) {
        errorUntil = now + CLAUDE_USAGE_ERROR_TTL_MS;
        return staleOk(now);
      }
      const usage = parseClaudeUsagePayload(await res.json(), new Date(now).toISOString());
      cache = { at: now, dir: cacheDirKey, value: usage };
      if (usage) lastGood = { at: now, dir: cacheDirKey, value: usage };
      return usage;
    } catch {
      errorUntil = now + CLAUDE_USAGE_ERROR_TTL_MS;
      return staleOk(now);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
