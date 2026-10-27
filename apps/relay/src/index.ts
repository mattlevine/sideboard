import path from 'node:path';
import { homedir } from 'node:os';
import { startRelayServer } from '@sideboard-ai/core';

/**
 * Hosted Sideboard relay.
 *
 * Env:
 *   SIDEBOARD_SLACK_APP_TOKEN      optional xapp-… — Slack Listen is off when this is unset
 *   SIDEBOARD_SLACK_CLIENT_SECRET  optional — only for the legacy Slack OAuth callback
 *   SIDEBOARD_SLACK_CLIENT_ID      optional; defaults to the public Sideboard Slack app id
 *   SIDEBOARD_RELAY_ACCOUNTS_PATH   SQLite file (Fly: /data/relay-accounts.sqlite on a volume)
 *   SIDEBOARD_RELAY_PUBLIC_ORIGIN   OAuth origin (https://relay.example.com)
 *   SIDEBOARD_RELAY_GITHUB_CLIENT_ID / SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET
 *   SIDEBOARD_RELAY_CURSOR_APP_ID     optional Origin app id (app_…). No client secret.
 *   SIDEBOARD_RELAY_ENTIRE_CLIENT_ID  optional Entire OIDC client. PKCE; secret optional.
 *   SIDEBOARD_RELAY_ENTIRE_CLIENT_SECRET  set only for a confidential Entire client.
 *   PORT                           listen port (default 8787)
 *   HOST                           bind address (default 0.0.0.0)
 *   SIDEBOARD_SITE_ROOT            optional. Set only to serve the marketing site
 *                                  (the hosted Fly app). A self-hosted relay leaves this unset.
 *   SIDEBOARD_SITE_HOSTS           hosts that serve the site (default: www.sideboard.cloud)
 *   SIDEBOARD_SITE_REDIRECT_HOSTS  hosts that 301 to the canonical site (default: sideboard.cloud)
 *   SIDEBOARD_SITE_CANONICAL       canonical site host (default: www.sideboard.cloud)
 *
 * Phone and Mac connect at wss://<host>/remote. A self-hosted process is that
 * relay only: no marketing site unless SIDEBOARD_SITE_ROOT is set.
 * Slack desktops use wss://relay.sideboard.cloud/slack/desktop when
 * SIDEBOARD_SLACK_APP_TOKEN is set. GET /slack/callback exchanges Slack OAuth.
 * GET / on www.sideboard.cloud serves the marketing site. GET
 * /oauth/abletime/callback bounces AbleTime OAuth to the desktop listener.
 * GET /health stays JSON for Fly checks.
 */
async function main(): Promise<void> {
  const appToken = process.env.SIDEBOARD_SLACK_APP_TOKEN?.trim() ?? '';
  const clientSecret = process.env.SIDEBOARD_SLACK_CLIENT_SECRET?.trim() ?? '';
  const port = Number(process.env.PORT || process.env.SIDEBOARD_SLACK_RELAY_PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const csv = (value: string | undefined, fallback: string[]): string[] => {
    const raw = value?.trim();
    if (!raw) return fallback;
    return raw.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  };
  const staticRoot = process.env.SIDEBOARD_SITE_ROOT?.trim() || '';
  const canonicalSiteHost =
    process.env.SIDEBOARD_SITE_CANONICAL?.trim().toLowerCase() || 'www.sideboard.cloud';
  const staticHosts = csv(process.env.SIDEBOARD_SITE_HOSTS, [canonicalSiteHost]);
  const redirectHosts = csv(process.env.SIDEBOARD_SITE_REDIRECT_HOSTS, ['sideboard.cloud']);
  const accountsPath =
    process.env.SIDEBOARD_RELAY_ACCOUNTS_PATH?.trim() ||
    (process.env.NODE_ENV === 'production'
      ? '/data/relay-accounts.sqlite'
      : path.join(homedir(), '.sideboard', 'relay-accounts.sqlite'));
  const client = (idKey: string, secretKey: string) => {
    const clientId = process.env[idKey]?.trim() ?? '';
    const clientSecret = process.env[secretKey]?.trim() ?? '';
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const github = client('SIDEBOARD_RELAY_GITHUB_CLIENT_ID', 'SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET');
  const cursorAppId = process.env.SIDEBOARD_RELAY_CURSOR_APP_ID?.trim() ?? '';
  const entireClientId = process.env.SIDEBOARD_RELAY_ENTIRE_CLIENT_ID?.trim() ?? '';
  const entireClientSecret = process.env.SIDEBOARD_RELAY_ENTIRE_CLIENT_SECRET?.trim() ?? '';
  if (!github) {
    console.log('warning: GitHub OAuth client is unset; GitHub sign-in is off on this relay');
  }
  if (!cursorAppId) {
    console.log('warning: Cursor Origin app id is unset; Cursor sign-in is off on this relay');
  }
  if (!entireClientId) {
    console.log('warning: Entire OAuth client id is unset; Entire sign-in is off on this relay');
  }
  if (!process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN?.trim()) {
    console.log('warning: SIDEBOARD_RELAY_PUBLIC_ORIGIN is unset; sign-in redirects use the listen address');
  }

  const ac = new AbortController();
  const shutdown = () => ac.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const handle = await startRelayServer({
    appToken,
    clientSecret,
    skipSocketMode: true,
    port,
    host,
    accountsPath,
    ...(staticRoot
      ? {
          staticRoot,
          staticHosts,
          redirectHosts,
          canonicalSiteHost,
        }
      : {}),
    relayOAuth: {
      github,
      ...(cursorAppId ? { cursor: { clientId: cursorAppId } } : {}),
      ...(entireClientId
        ? {
            entire: {
              clientId: entireClientId,
              ...(entireClientSecret ? { clientSecret: entireClientSecret } : {}),
            },
          }
        : {}),
    },
    signal: ac.signal,
    onLog: (line) => console.log(line),
  });

  const listenHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`sideboard relay ready · ${handle.url}`);
  console.log('phone remote · /remote');
  if (staticRoot) console.log(`site · https://${canonicalSiteHost}/`);
  console.log(`accounts · ${accountsPath}`);
  console.log(`health · http://${listenHost}:${handle.port}/health`);

  await new Promise<void>((resolve) => {
    ac.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  await handle.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
