import { randomBytes } from 'node:crypto';
import { loadAppSettings } from '../store/app-settings.js';
import { upsertSlackWorkspace, type SlackWorkspaceInfo } from './workspaces.js';
import { BAKED_SLACK_CLIENT_ID } from './baked-app.js';
import { slackOAuthRedirectUri } from './oauth-redirect.js';
import {
  slackOAuthResultUrl,
  type SlackOAuthTokenPayload,
} from './oauth-exchange.js';

export { hasBakedSlackOAuth } from './baked-app.js';
export {
  SLACK_OAUTH_REDIRECT,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';
export { slackOAuthResultUrl, slackRelayHttpOrigin } from './oauth-exchange.js';

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'chat:write',
  'chat:write.public',
  'reactions:write',
  'users:read',
  'users:read.email',
  'team:read',
].join(',');

export const SLACK_USER_SCOPES = [
  'search:read',
  'channels:history',
  'channels:read',
  'groups:history',
  'im:history',
  'mpim:history',
  'chat:write',
  'users:read',
].join(',');

/** Public client id plus optional local secret (custom Slack app only — not baked). */
export function slackOAuthCredentials(): { clientId: string; clientSecret: string | null } {
  const settings = loadAppSettings();
  const clientId =
    process.env.SIDEBOARD_SLACK_CLIENT_ID?.trim() ||
    settings.integrations.slackClientId?.trim() ||
    BAKED_SLACK_CLIENT_ID.trim();
  const clientSecret =
    process.env.SIDEBOARD_SLACK_CLIENT_SECRET?.trim() ||
    settings.integrations.slackClientSecret?.trim() ||
    '';
  if (!clientId) {
    throw new Error(
      'Slack browser sign-in needs a Slack app Client ID (Settings → Remote → Slack, or SIDEBOARD_SLACK_CLIENT_ID). You can still paste an xoxb- or xoxp- token.',
    );
  }
  return { clientId, clientSecret: clientSecret || null };
}

export const SLACK_OAUTH_CANCELLED = 'Slack sign-in cancelled';

export class SlackOAuthCancelledError extends Error {
  constructor(message = SLACK_OAUTH_CANCELLED) {
    super(message);
    this.name = 'SlackOAuthCancelledError';
  }
}

export function isSlackOAuthCancelled(err: unknown): boolean {
  if (err instanceof SlackOAuthCancelledError) return true;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(SLACK_OAUTH_CANCELLED)) return true;
  return err instanceof Error && err.name === 'SlackOAuthCancelledError';
}

/**
 * Slack authorize URL. We always start at slack.com; Slack then sends
 * undistributed apps to the home workspace (today: brightsy.slack.com).
 * Other teams appear in the picker only after Manage Distribution →
 * Activate Public Distribution.
 */
export function slackOAuthAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES,
    user_scope: SLACK_USER_SCOPES,
    redirect_uri: slackOAuthRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SlackOAuthCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SlackOAuthCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function upsertFromPayload(payload: SlackOAuthTokenPayload): SlackWorkspaceInfo {
  return upsertSlackWorkspace({
    team_id: payload.team_id,
    team_name: payload.team_name,
    user_id: payload.user_id,
    bot_token: payload.bot_token,
    user_token: payload.user_token,
    scopes: payload.scopes,
    connected_at: new Date().toISOString(),
  });
}

/**
 * Open Slack OAuth in the browser. The hosted relay exchanges the code
 * (client secret stays on the server). This process polls `/slack/oauth/result`.
 */
export async function startSlackOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resultUrlForState?: (state: string) => string;
  pollIntervalMs?: number;
}): Promise<SlackWorkspaceInfo> {
  if (opts?.signal?.aborted) {
    throw new SlackOAuthCancelledError();
  }
  const { clientId } = slackOAuthCredentials();
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = slackOAuthAuthorizeUrl(clientId, state);
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 400;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const resultUrl = opts?.resultUrlForState?.(state) ?? slackOAuthResultUrl(state);

  await Promise.resolve(opts?.openUrl?.(authorizeUrl));
  if (opts?.signal?.aborted) {
    throw new SlackOAuthCancelledError();
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) {
      throw new SlackOAuthCancelledError();
    }
    let res: Response;
    try {
      res = await fetchImpl(resultUrl);
    } catch {
      if (opts?.signal?.aborted) throw new SlackOAuthCancelledError();
      await sleep(pollIntervalMs, opts?.signal);
      continue;
    }
    let data: {
      ok?: boolean;
      error?: string;
      team_id?: string;
      team_name?: string;
      user_id?: string;
      bot_token?: string;
      user_token?: string;
      scopes?: string;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      await sleep(pollIntervalMs, opts?.signal);
      continue;
    }
    if (data.ok && data.team_id?.trim()) {
      return upsertFromPayload({
        team_id: data.team_id.trim(),
        team_name: data.team_name?.trim() || data.team_id.trim(),
        user_id: data.user_id?.trim() || undefined,
        bot_token: data.bot_token?.trim() || undefined,
        user_token: data.user_token?.trim() || undefined,
        scopes: data.scopes?.trim() || '',
      });
    }
    const err = data.error?.trim();
    if (err && err !== 'pending') {
      if (/cancel/i.test(err) || /access_denied/i.test(err)) {
        throw new SlackOAuthCancelledError(`Slack OAuth: ${err}`);
      }
      throw new Error(err.startsWith('Slack') ? err : `Slack OAuth: ${err}`);
    }
    await sleep(pollIntervalMs, opts?.signal);
  }
  throw new Error('Slack sign-in timed out — try again');
}
