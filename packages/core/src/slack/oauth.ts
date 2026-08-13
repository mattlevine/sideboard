import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadAppSettings } from '../store/app-settings.js';
import { upsertSlackWorkspace, type SlackWorkspaceInfo } from './workspaces.js';
import {
  BAKED_SLACK_CLIENT_ID,
  BAKED_SLACK_CLIENT_SECRET,
} from './baked-app.js';

export { hasBakedSlackOAuth } from './baked-app.js';

/** Fixed port so the Slack app redirect URI can be registered once. */
export const SLACK_OAUTH_PORT = 19847;
export const SLACK_OAUTH_REDIRECT = `http://127.0.0.1:${SLACK_OAUTH_PORT}/callback`;

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

export function slackOAuthAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES,
    user_scope: SLACK_USER_SCOPES,
    redirect_uri: SLACK_OAUTH_REDIRECT,
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
 */
export async function startSlackOAuth(opts?: {
  openUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
}): Promise<SlackWorkspaceInfo> {
  const { clientId, clientSecret } = slackOAuthCredentials();
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = slackOAuthAuthorizeUrl(clientId, state);
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;

  const code = await new Promise<string>((resolve, reject) => {
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
          cleanup();
          reject(new Error(`Slack OAuth: ${err}`));
          return;
        }
        if (gotState !== state || !gotCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlPage('Slack', '<h1>Invalid callback</h1><p>State or code missing.</p>'));
          cleanup();
          reject(new Error('Slack OAuth callback was invalid'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          htmlPage(
            'Slack connected',
            '<h1>Slack workspace connected</h1><p>You can close this tab and return to Sideboard.</p>',
          ),
        );
        cleanup();
        resolve(gotCode);
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Slack sign-in timed out — try again'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.on('error', (e) => {
      cleanup();
      reject(
        e instanceof Error && (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new Error(
              `Port ${SLACK_OAUTH_PORT} is in use. Close whatever is bound there, or paste a Slack token instead.`,
            )
          : e,
      );
    });

    server.listen(SLACK_OAUTH_PORT, '127.0.0.1', () => {
      void Promise.resolve(opts?.openUrl?.(authorizeUrl)).catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  });

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: SLACK_OAUTH_REDIRECT,
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
