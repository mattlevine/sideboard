import { run } from '../git/run.js';
import {
  loadBrightsyConfig,
  saveBrightsyConfig,
  type BrightsyLocalConfig,
} from './config.js';

export interface BrightsyAccount {
  id: string;
  name: string;
  slug: string;
  picture_url?: string;
  role?: string;
  is_personal_account?: boolean;
  active?: boolean;
}

export interface ConnectedBrightsyTeamInfo {
  id: string;
  slug: string;
  name: string;
  expires_at?: number;
}

export interface BrightsySession {
  connected: boolean;
  endpoint: string;
  /** CLI / Brightsy agent active team (~/.brightsy). */
  accountId: string | null;
  accountSlug: string | null;
  accounts: BrightsyAccount[];
  /** Teams connected in Sideboard for concurrent MCP injection. */
  connectedTeams: ConnectedBrightsyTeamInfo[];
  reason?: string;
}

type CliTeamsList = {
  endpoint?: string;
  active?: BrightsyAccount | null;
  teams?: BrightsyAccount[];
};

type CliTeamsSwitch = {
  endpoint?: string;
  active?: BrightsyAccount;
  switched?: boolean;
};

/** Lazy import avoids circular dependency with connected-teams.ts. */
async function loadConnectedTeams(): Promise<ConnectedBrightsyTeamInfo[]> {
  const { listConnectedBrightsyTeams } = await import('./connected-teams.js');
  return listConnectedBrightsyTeams();
}

async function runBrightsyTeamsJson(args: string[]): Promise<unknown> {
  const listed = await run('brightsy', ['teams', ...args, '--json'], {
    reject: false,
  });
  if (listed.exitCode !== 0) {
    throw new Error(
      listed.stderr.trim() ||
        listed.stdout.trim() ||
        'brightsy teams failed — is `@brightsy/cli` installed and logged in?',
    );
  }
  const raw = listed.stdout.trim();
  if (!raw) {
    throw new Error('brightsy teams returned empty output');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('brightsy teams returned invalid JSON');
  }
}

/** List teams via `brightsy teams --json`. */
export async function listBrightsyAccounts(): Promise<BrightsyAccount[]> {
  const data = (await runBrightsyTeamsJson([])) as CliTeamsList;
  return Array.isArray(data.teams) ? data.teams : [];
}

export async function getBrightsySession(): Promise<BrightsySession> {
  try {
    loadBrightsyConfig(); // ensure login file exists
    const data = (await runBrightsyTeamsJson([])) as CliTeamsList;
    const accounts = Array.isArray(data.teams) ? data.teams : [];
    const active =
      data.active ??
      accounts.find((a) => a.active) ??
      null;

    // Keep CLI login and Sideboard team selection as one list.
    const { ensureCliTeamTracked } = await import('./connected-teams.js');
    const connectedTeams = ensureCliTeamTracked(
      active
        ? { id: active.id, slug: active.slug, name: active.name }
        : undefined,
    );

    return {
      connected: true,
      endpoint: (data.endpoint || 'https://brightsy.ai').replace(/\/$/, ''),
      accountId: active?.id ?? null,
      accountSlug: active?.slug ?? null,
      accounts,
      connectedTeams,
    };
  } catch (err) {
    return {
      connected: false,
      endpoint: 'https://brightsy.ai',
      accountId: null,
      accountSlug: null,
      accounts: [],
      connectedTeams: await loadConnectedTeams(),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Switch active team via `brightsy teams switch <id> --json`.
 * Updates ~/.brightsy through the Brightsy CLI (same as Desktop/MCP).
 */
export async function performBrightsyAccountSwitch(
  accountIdOrSlug: string,
): Promise<{ cfg: BrightsyLocalConfig; target: BrightsyAccount }> {
  const data = (await runBrightsyTeamsJson([
    'switch',
    accountIdOrSlug,
  ])) as CliTeamsSwitch;
  if (!data.active?.id) {
    throw new Error(`Team switch failed for: ${accountIdOrSlug}`);
  }
  // CLI already wrote ~/.brightsy; re-read for callers that need the token.
  const cfg = loadBrightsyConfig();
  // Ensure slug stays in sync if CLI returned a richer active object.
  if (data.active.slug && data.active.slug !== cfg.account_slug) {
    cfg.account_slug = data.active.slug;
    saveBrightsyConfig(cfg);
  }
  return { cfg, target: data.active };
}

/**
 * Activate a Brightsy team for CLI + MCP (same as connecting in Settings).
 */
export async function switchBrightsyAccount(
  accountIdOrSlug: string,
): Promise<BrightsySession> {
  const { connectBrightsyTeam } = await import('./connected-teams.js');
  await connectBrightsyTeam(accountIdOrSlug);
  return getBrightsySession();
}
