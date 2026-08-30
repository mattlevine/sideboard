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
  const next: SlackWorkspace = {
    team_id: teamId,
    team_name: auth.team?.trim() || existing?.team_name || teamId,
    user_id: auth.user_id?.trim() || existing?.user_id,
    bot_token: kind === 'bot' ? token : existing?.bot_token,
    user_token: kind === 'user' || kind === 'unknown' ? token : existing?.user_token,
    scopes: existing?.scopes,
    connected_at: existing?.connected_at || new Date().toISOString(),
  };
  if (kind === 'unknown' && auth.bot_id) {
    next.bot_token = token;
    next.user_token = existing?.user_token;
  }
  return upsertSlackWorkspace(next);
}

export function slackTokenFor(
  ws: SlackWorkspace,
  kind: 'search' | 'write' | 'read' = 'read',
): string {
  if (kind === 'search') {
    const token = ws.user_token?.trim();
    if (!token) {
      throw new Error(
        `Slack search needs a user token for ${ws.team_name}. Reconnect via Settings → Remote → Slack (browser) or paste an xoxp- token.`,
      );
    }
    return token;
  }
  // Prefer the bot token so chat.postMessage lands as the app, not the user
  // (user tokens from OAuth often lack chat:write).
  const token = (kind === 'write'
    ? ws.bot_token || ws.user_token
    : ws.user_token || ws.bot_token
  )?.trim();
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
        ? 'Connect a workspace in Settings → Remote → Slack.'
        : `Connected: ${connected.map((t) => `${t.team_name} (${t.team_id})`).join(', ')}`;
    throw new Error(`Unknown Slack team_id "${teamId}". ${hint}`);
  }
  return ws;
}
