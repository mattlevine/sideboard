import { BAKED_SLACK_CLIENT_ID, slackRelayUrl } from './baked-app.js';
import {
  SLACK_OAUTH_REDIRECT,
  SLACK_OAUTH_RESULT_PATH,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';

export interface SlackOAuthTokenPayload {
  team_id: string;
  team_name: string;
  user_id?: string;
  bot_token?: string;
  user_token?: string;
  scopes: string;
}

export type SlackOAuthPendingValue =
  | { ok: true; payload: SlackOAuthTokenPayload }
  | { ok: false; error: string };

interface OauthV2Access {
  ok: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  authed_user?: {
    id?: string;
    scope?: string;
    access_token?: string;
  };
  team?: { id?: string; name?: string };
}

const PENDING_TTL_MS = 5 * 60_000;

/** In-memory one-time OAuth results, keyed by the authorize `state`. */
export class SlackOAuthPendingStore {
  private readonly items = new Map<string, { expiresAt: number; value: SlackOAuthPendingValue }>();

  put(state: string, value: SlackOAuthPendingValue): void {
    const id = state.trim();
    if (!id) return;
    this.sweep();
    const existing = this.items.get(id);
    // Duplicate Slack/browser GETs retry the one-time code; keep the first success.
    if (existing && existing.value.ok && !value.ok) return;
    this.items.set(id, { expiresAt: Date.now() + PENDING_TTL_MS, value });
  }

  /** Consume a pending result. Missing/expired → null (desktop should keep polling). */
  take(state: string): SlackOAuthPendingValue | null {
    const id = state.trim();
    if (!id) return null;
    this.sweep();
    const row = this.items.get(id);
    if (!row) return null;
    this.items.delete(id);
    return row.value;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, row] of this.items) {
      if (row.expiresAt <= now) this.items.delete(key);
    }
  }
}

export function slackRelayHttpOrigin(relayWsUrl?: string): string {
  const raw = (relayWsUrl ?? slackRelayUrl()).trim();
  const http = raw.replace(/^ws/i, 'http');
  const u = new URL(http);
  return `${u.protocol}//${u.host}`;
}

export function slackOAuthResultUrl(state: string, relayWsUrl?: string): string {
  const u = new URL(SLACK_OAUTH_RESULT_PATH, slackRelayHttpOrigin(relayWsUrl));
  u.searchParams.set('state', state);
  return u.toString();
}

export function slackOAuthRelayClientId(): string {
  return process.env.SIDEBOARD_SLACK_CLIENT_ID?.trim() || BAKED_SLACK_CLIENT_ID.trim();
}

export function slackOAuthRelayRedirectUri(): string {
  return slackOAuthRedirectUri() || SLACK_OAUTH_REDIRECT;
}

export async function exchangeSlackOAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOAuthTokenPayload> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as OauthV2Access;
  if (!data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${data.error || res.status}`);
  }
  const teamId = data.team?.id?.trim();
  if (!teamId) throw new Error('Slack OAuth did not return a team id');
  return {
    team_id: teamId,
    team_name: data.team?.name?.trim() || teamId,
    user_id: data.authed_user?.id?.trim() || undefined,
    bot_token: data.access_token?.trim() || undefined,
    user_token: data.authed_user?.access_token?.trim() || undefined,
    scopes: [data.scope, data.authed_user?.scope].filter(Boolean).join(','),
  };
}
