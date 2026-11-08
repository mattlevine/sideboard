import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import {
  isSecureFileEncrypted,
  readSecureJson,
  resolveVaultKey,
  writeSecureJson,
} from '../store/secure-file.js';
import { slackAuthTest } from './api.js';

export interface SlackWorkspace {
  team_id: string;
  team_name: string;
  user_id?: string;
  bot_token?: string;
  user_token?: string;
  /** Relay proof of OAuth authed_user. Not a Slack API token. */
  listen_grant?: string;
  scopes?: string;
  connected_at: string;
}

/** Safe to send to the renderer / MCP (no tokens). */
export interface SlackWorkspaceInfo {
  team_id: string;
  team_name: string;
  user_id?: string;
  has_bot_token: boolean;
  has_user_token: boolean;
  connected_at: string;
}

function storePath(): string {
  return join(appDataDir(), 'slack-workspaces.json');
}

function readStore(): SlackWorkspace[] {
  try {
    const path = storePath();
    const wasEncrypted = isSecureFileEncrypted(path);
    const parsed = readSecureJson<{ workspaces?: SlackWorkspace[] }>(path);
    const workspaces = Array.isArray(parsed?.workspaces) ? parsed.workspaces : [];
    if (workspaces.length > 0 && !wasEncrypted && resolveVaultKey()) {
      writeSecureJson(path, { workspaces });
    }
    return workspaces;
  } catch {
    return [];
  }
}

function writeStore(workspaces: SlackWorkspace[]): SlackWorkspace[] {
  writeSecureJson(storePath(), { workspaces });
  return workspaces;
}

function toInfo(ws: SlackWorkspace): SlackWorkspaceInfo {
  return {
    team_id: ws.team_id,
    team_name: ws.team_name,
    user_id: ws.user_id,
    has_bot_token: Boolean(ws.bot_token),
    has_user_token: Boolean(ws.user_token),
    connected_at: ws.connected_at,
  };
}

/** Bot token plus a user token or listen grant. A pasted bot token alone cannot Listen. */
export function slackWorkspaceCanListen(ws: SlackWorkspace): boolean {
  return Boolean(
    ws.bot_token?.trim() &&
      ws.user_id?.trim() &&
      (ws.user_token?.trim() || ws.listen_grant?.trim()),
  );
}

export function listSlackWorkspaces(): SlackWorkspaceInfo[] {
  return readStore()
    .map(toInfo)
    .sort((a, b) => a.team_name.localeCompare(b.team_name));
}

/** Full records including tokens — Socket Mode listen / reply only. Never send to renderer. */
export function listSlackWorkspacesRaw(): SlackWorkspace[] {
  return readStore();
}

export function getSlackWorkspace(teamId: string): SlackWorkspace | null {
  const id = teamId.trim();
  if (!id) return null;
  return (
    readStore().find(
      (ws) => ws.team_id === id || ws.team_name.toLowerCase() === id.toLowerCase(),
    ) ?? null
  );
}

export function upsertSlackWorkspace(entry: SlackWorkspace): SlackWorkspaceInfo {
  const workspaces = readStore().filter((ws) => ws.team_id !== entry.team_id);
  workspaces.push(entry);
  writeStore(workspaces);
  return toInfo(entry);
}

export function disconnectSlackWorkspace(teamId: string): SlackWorkspaceInfo[] {
  const id = teamId.trim();
  writeStore(readStore().filter((ws) => ws.team_id !== id));
  return listSlackWorkspaces();
}

function tokenKind(token: string): 'bot' | 'user' | 'unknown' {
  if (token.startsWith('xoxb-')) return 'bot';
  if (token.startsWith('xoxp-') || token.startsWith('xoxe.xoxp-')) return 'user';
  return 'unknown';
}

/** Add or update a workspace from a pasted bot (`xoxb-`) or user (`xoxp-`) token. */
export async function connectSlackToken(rawToken: string): Promise<SlackWorkspaceInfo> {
  const token = rawToken.trim();
  if (!token) throw new Error('Paste a Slack bot (xoxb-) or user (xoxp-) token');
  const auth = await slackAuthTest(token);
  const teamId = auth.team_id?.trim();
  if (!teamId) throw new Error('Slack auth.test did not return a team_id');
  const existing = getSlackWorkspace(teamId);
  const kind = tokenKind(token);
  const authUserId = auth.user_id?.trim();
  // A bot token's auth.test user is the bot, not the person who finished OAuth.
  const userId =
    kind === 'bot' ? existing?.user_id || authUserId : authUserId || existing?.user_id;
  const next: SlackWorkspace = {
    team_id: teamId,
    team_name: auth.team?.trim() || existing?.team_name || teamId,
    user_id: userId,
    bot_token: kind === 'bot' ? token : existing?.bot_token,
    user_token: kind === 'user' || kind === 'unknown' ? token : existing?.user_token,
    listen_grant:
      existing?.user_id && userId && existing.user_id !== userId ? undefined : existing?.listen_grant,
    scopes: existing?.scopes,
    connected_at: existing?.connected_at || new Date().toISOString(),
  };
  if (kind === 'unknown' && auth.bot_id) {
    next.bot_token = token;
    next.user_token = existing?.user_token;
    next.user_id = existing?.user_id || authUserId;
    if (existing?.user_id && next.user_id && existing.user_id !== next.user_id) {
      next.listen_grant = undefined;
    }
  }
  return upsertSlackWorkspace(next);
}

export function slackTokenFor(
  ws: SlackWorkspace,
  _kind: 'write' | 'read' = 'read',
): string {
  // Bot token for both. Posting and reading the reply use bot scopes.
  // A pasted user token is only a fallback when this workspace has no bot token.
  const token = (ws.bot_token || ws.user_token)?.trim();
  if (!token) {
    throw new Error(`Slack workspace ${ws.team_name} has no token`);
  }
  return token;
}

export function requireSlackWorkspace(teamId: string): SlackWorkspace {
  const ws = getSlackWorkspace(teamId);
  if (!ws) {
    const connected = listSlackWorkspaces();
    const hint =
      connected.length === 0
        ? 'Connect a workspace in Settings → Collaboration.'
        : `Connected: ${connected.map((t) => `${t.team_name} (${t.team_id})`).join(', ')}`;
    throw new Error(`Unknown Slack team_id "${teamId}". ${hint}`);
  }
  return ws;
}
