import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadAppSettings } from '../store/app-settings.js';
import { upsertSlackWorkspace, type SlackWorkspaceInfo } from './workspaces.js';
import {
  BAKED_SLACK_CLIENT_ID,
  BAKED_SLACK_CLIENT_SECRET,
} from './baked-app.js';
import {
  SLACK_OAUTH_PORT,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';

export { hasBakedSlackOAuth } from './baked-app.js';
export {
  SLACK_OAUTH_PORT,
  SLACK_OAUTH_REDIRECT,
  SLACK_OAUTH_LOCAL_CALLBACK,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';

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

export function slackOAuthCredentials(): { clientId: string; clientSecret: string } {
  const settings = loadAppSettings();
  const clientId =
    process.env.SIDEBOARD_SLACK_CLIENT_ID?.trim() ||
    settings.integrations.slackClientId?.trim() ||
    BAKED_SLACK_CLIENT_ID.trim();
  const clientSecret =
    process.env.SIDEBOARD_SLACK_CLIENT_SECRET?.trim() ||
    settings.integrations.slackClientSecret?.trim() ||
    BAKED_SLACK_CLIENT_SECRET.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Slack browser sign-in needs a Slack app Client ID and Secret (Account → Slack, or SIDEBOARD_SLACK_CLIENT_ID / SIDEBOARD_SLACK_CLIENT_SECRET). You can still paste an xoxb- or xoxp- token.',
    );
  }
  return { clientId, clientSecret };
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

interface OauthV2Access {
  ok: boolean;
  access_token?: string;
  scope?: string;
  authed_user?: {
    id?: string;
    scope?: string;
    access_token?: string;
  };
  team?: { id?: string; name?: string };
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}</style></head><body>${body}</body></html>`;
}

/**
 * Open Slack OAuth in the browser, listen on a localhost callback, store tokens.
 * Slack redirects to the hosted HTTPS bounce, which forwards here.
 * Pass `signal` (or abort after start) so closing the browser tab is not the
 * only way out — Settings Cancel and modal close abort this wait.
 */
export async function startSlackOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SlackWorkspaceInfo> {
  if (opts?.signal?.aborted) {
    throw new SlackOAuthCancelledError();
  }
  const { clientId, clientSecret } = slackOAuthCredentials();
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = slackOAuthAuthorizeUrl(clientId, state);
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value!);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${SLACK_OAUTH_PORT}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const err = url.searchParams.get('error');
        const gotState = url.searchParams.get('state');
        const gotCode = url.searchParams.get('code');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('Slack', `<h1>Authorization cancelled</h1><p>${err}</p>`));
          finish(new SlackOAuthCancelledError(`Slack OAuth: ${err}`));
          return;
        }
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('Slack', '<h1>Invalid callback</h1><p>State or code missing.</p>'));
          finish(new Error('Slack OAuth callback was invalid'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          htmlPage(
            'Slack connected',
            '<h1>Slack workspace connected</h1><p>You can close this tab and return to Sideboard.</p>',
          ),
        );
        finish(undefined, gotCode);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error('Slack sign-in timed out — try again'));
    }, timeoutMs);

    const onAbort = () => finish(new SlackOAuthCancelledError());

    const cleanup = () => {
      clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
      server.close();
    };

    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts?.signal?.aborted) {
      onAbort();
      return;
    }

    server.on('error', (e) => {
      finish(
        e instanceof Error && (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new Error(
              `Port ${SLACK_OAUTH_PORT} is in use. Close whatever is bound there, or paste a Slack token instead.`,
            )
          : e instanceof Error
            ? e
            : new Error(String(e)),
      );
    });

    server.listen(SLACK_OAUTH_PORT, '127.0.0.1', () => {
      void Promise.resolve(opts?.openUrl?.(authorizeUrl)).catch((e) => {
        finish(e instanceof Error ? e : new Error(String(e)));
      });
    });
  });

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: slackOAuthRedirectUri(),
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as OauthV2Access & { error?: string };
  if (!data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${data.error || res.status}`);
  }
  const teamId = data.team?.id?.trim();
  if (!teamId) throw new Error('Slack OAuth did not return a team id');
  return upsertSlackWorkspace({
    team_id: teamId,
    team_name: data.team?.name?.trim() || teamId,
    user_id: data.authed_user?.id,
    bot_token: data.access_token,
    user_token: data.authed_user?.access_token,
    scopes: [data.scope, data.authed_user?.scope].filter(Boolean).join(','),
    connected_at: new Date().toISOString(),
  });
}
