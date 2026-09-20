import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import {
  listBrightsyAccounts,
  performBrightsyAccountSwitch,
} from './accounts.js';
import {
  loadBrightsyConfig,
  saveBrightsyConfig,
  type BrightsyLocalConfig,
} from './config.js';
import {
  brightsyAccessTokenNeedsRefresh,
  ensureBrightsyLocalConfigFresh,
  ensureBrightsyOAuthClientId,
  refreshBrightsyAccessToken,
} from './oauth.js';

import type { ConnectedBrightsyTeamInfo } from './accounts.js';

/** Team connection stored in Sideboard (tokens for MCP + CLI sync). */
export interface ConnectedBrightsyTeam {
  id: string;
  slug: string;
  name: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  endpoint?: string;
  /** RFC 7591 client id used to mint/refresh this team's tokens. */
  oauth_client_id?: string;
}

export type { ConnectedBrightsyTeamInfo };

function storePath(): string {
  return join(appDataDir(), 'brightsy-teams.json');
}

function readStore(): ConnectedBrightsyTeam[] {
  const path = storePath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      teams?: ConnectedBrightsyTeam[];
    };
    return Array.isArray(parsed.teams) ? parsed.teams : [];
  } catch {
    return [];
  }
}

function writeStore(teams: ConnectedBrightsyTeam[]): ConnectedBrightsyTeam[] {
  mkdirSync(appDataDir(), { recursive: true });
  const path = storePath();
  writeFileSync(path, `${JSON.stringify({ teams }, null, 2)}\n`, {
    mode: 0o600,
  });
  return teams;
}

export function listConnectedBrightsyTeams(): ConnectedBrightsyTeamInfo[] {
  return readStore().map(({ id, slug, name, expires_at }) => ({
    id,
    slug,
    name,
    expires_at,
  }));
}

export function getConnectedBrightsyTeamsRaw(): ConnectedBrightsyTeam[] {
  return readStore();
}

/** Point ~/.brightsy at a Sideboard-connected team (CLI + Brightsy agent). */
export function applyConnectedTeamToCli(team: ConnectedBrightsyTeam): void {
  let base: Partial<BrightsyLocalConfig> = {};
  try {
    base = loadBrightsyConfig();
  } catch {
    // First write after connect may still have a valid file from login.
  }
  saveBrightsyConfig({
    ...base,
    access_token: team.access_token,
    refresh_token: team.refresh_token ?? base.refresh_token,
    expires_at: team.expires_at ?? base.expires_at,
    account_id: team.id,
    account_slug: team.slug,
    endpoint: team.endpoint ?? base.endpoint ?? 'https://brightsy.ai',
    oauth_client_id: team.oauth_client_id ?? base.oauth_client_id,
  } as BrightsyLocalConfig);
}

async function refreshTeamToken(
  team: ConnectedBrightsyTeam,
  opts?: { fetchImpl?: typeof fetch },
): Promise<ConnectedBrightsyTeam> {
  if (!team.refresh_token) return team;
  const cfg = (() => {
    try {
      return loadBrightsyConfig();
    } catch {
      return null;
    }
  })();
  const endpoint = team.endpoint || 'https://brightsy.ai';
  const clientId = await ensureBrightsyOAuthClientId({
    endpoint,
    clientId: team.oauth_client_id || cfg?.oauth_client_id,
    fetchImpl: opts?.fetchImpl,
  });
  const grant = await refreshBrightsyAccessToken({
    endpoint,
    refreshToken: team.refresh_token,
    clientId,
    fetchImpl: opts?.fetchImpl,
  });
  if (!grant) return { ...team, oauth_client_id: clientId || team.oauth_client_id };
  return {
    ...team,
    access_token: grant.access_token,
    refresh_token: grant.refresh_token || team.refresh_token,
    expires_at: grant.expires_at ?? team.expires_at,
    oauth_client_id: clientId,
  };
}

/** Ensure stored team tokens are fresh; returns teams ready for MCP env injection. */
export async function ensureConnectedBrightsyTeamTokens(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<ConnectedBrightsyTeam[]> {
  await ensureBrightsyLocalConfigFresh({ fetchImpl: opts?.fetchImpl }).catch(
    () => null,
  );
  const teams = readStore();
  if (teams.length === 0) return [];
  const cfg = (() => {
    try {
      return loadBrightsyConfig();
    } catch {
      return null;
    }
  })();
  const next: ConnectedBrightsyTeam[] = [];
  let changed = false;
  for (const team of teams) {
    let current = team;
    // Backfill DCR client id even when the access token is still valid — MCP
    // env needs BRIGHTSY_OAUTH_CLIENT_ID before the hour-later refresh.
    if (!current.oauth_client_id?.trim()) {
      const endpoint = current.endpoint || 'https://brightsy.ai';
      const clientId = await ensureBrightsyOAuthClientId({
        endpoint,
        clientId: cfg?.oauth_client_id,
        fetchImpl: opts?.fetchImpl,
      });
      if (clientId && clientId !== current.oauth_client_id) {
        current = { ...current, oauth_client_id: clientId };
        changed = true;
      }
    }
    if (!current.refresh_token || !brightsyAccessTokenNeedsRefresh(current.expires_at)) {
      next.push(current);
      continue;
    }
    const refreshed = await refreshTeamToken(current, opts);
    if (
      refreshed.access_token !== current.access_token ||
      refreshed.refresh_token !== current.refresh_token ||
      refreshed.expires_at !== current.expires_at ||
      refreshed.oauth_client_id !== current.oauth_client_id
    ) {
      changed = true;
    }
    next.push(refreshed);
  }
  if (changed) writeStore(next);

  // Keep ~/.brightsy aligned with the active connected team when possible.
  try {
    const cfg = loadBrightsyConfig();
    const active = next.find((t) => t.id === cfg.account_id);
    if (active && active.access_token !== cfg.access_token) {
      applyConnectedTeamToCli(active);
    }
  } catch {
    // Not logged in.
  }

  return next;
}

/**
 * Seed Sideboard's connected-team store from the current ~/.brightsy session
 * so CLI login and MCP selection stay one list.
 */
export function ensureCliTeamTracked(meta?: {
  id: string;
  slug: string;
  name: string;
}): ConnectedBrightsyTeamInfo[] {
  try {
    const cfg = loadBrightsyConfig();
    const existing = readStore();
    if (existing.some((t) => t.id === cfg.account_id)) {
      return listConnectedBrightsyTeams();
    }
    const team: ConnectedBrightsyTeam = {
      id: cfg.account_id,
      slug: meta?.slug || cfg.account_slug || cfg.account_id,
      name: meta?.name || cfg.account_slug || cfg.account_id,
      access_token: cfg.access_token,
      refresh_token: cfg.refresh_token,
      expires_at: cfg.expires_at,
      endpoint: cfg.endpoint,
      oauth_client_id: cfg.oauth_client_id,
    };
    writeStore([...existing, team]);
  } catch {
    // Not logged in.
  }
  return listConnectedBrightsyTeams();
}

/**
 * Connect a team for MCP + CLI: mint/store a team token and make it the
 * active ~/.brightsy session (Brightsy agent / CLI).
 */
export async function connectBrightsyTeam(
  accountIdOrSlug: string,
): Promise<ConnectedBrightsyTeamInfo[]> {
  const accounts = await listBrightsyAccounts();
  const target =
    accounts.find((a) => a.id === accountIdOrSlug) ??
    accounts.find((a) => a.slug === accountIdOrSlug);
  if (!target) {
    throw new Error(`Brightsy team not found: ${accountIdOrSlug}`);
  }

  const existing = readStore();
  const already = existing.find((t) => t.id === target.id);
  if (already) {
    // Re-selecting a connected team just makes it the CLI active session.
    applyConnectedTeamToCli(already);
    return listConnectedBrightsyTeams();
  }

  const { cfg: minted } = await performBrightsyAccountSwitch(target.id);

  const team: ConnectedBrightsyTeam = {
    id: target.id,
    slug: target.slug,
    name: target.name,
    access_token: minted.access_token,
    refresh_token: minted.refresh_token,
    expires_at: minted.expires_at,
    endpoint: minted.endpoint,
    oauth_client_id: minted.oauth_client_id,
  };
  // ~/.brightsy is already on this team — one selection drives CLI and MCP.
  writeStore([...existing, team]);
  return listConnectedBrightsyTeams();
}

export async function disconnectBrightsyTeam(
  accountIdOrSlug: string,
): Promise<ConnectedBrightsyTeamInfo[]> {
  const before = readStore();
  const removed = before.find(
    (t) => t.id === accountIdOrSlug || t.slug === accountIdOrSlug,
  );
  const teams = before.filter(
    (t) => t.id !== accountIdOrSlug && t.slug !== accountIdOrSlug,
  );
  writeStore(teams);

  if (removed) {
    try {
      const cfg = loadBrightsyConfig();
      if (cfg.account_id === removed.id) {
        if (teams[0]) {
          applyConnectedTeamToCli(teams[0]);
        }
      }
    } catch {
      // Not logged in.
    }
  }

  return listConnectedBrightsyTeams();
}

/** Sanitize slug for Claude MCP server / tool name segments. */
export function brightsyMcpServerName(slug: string): string {
  const cleaned = slug.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return `brightsy_${cleaned || 'team'}`;
}
