import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSlackRelayServer } from '@sideboard-ai/core';

/**
 * Hosted Slack inbound relay.
 *
 * Env:
 *   SIDEBOARD_SLACK_APP_TOKEN      required xapp-… (connections:write) — never ship in the DMG
 *   SIDEBOARD_SLACK_CLIENT_SECRET  required for Add via browser (OAuth exchange) — never ship in git/DMG
 *   SIDEBOARD_SLACK_CLIENT_ID      optional; defaults to the public Sideboard Slack app id
 *   PORT                           listen port (default 8787)
 *   HOST                           bind address (default 0.0.0.0)
 *   SIDEBOARD_SITE_ROOT            optional static marketing site (default: repo site/)
 *   SIDEBOARD_SITE_HOSTS           hosts that serve the site (default: www.sideboard.cloud)
 *   SIDEBOARD_SITE_REDIRECT_HOSTS  hosts that 301 to the canonical site (default: sideboard.cloud)
 *   SIDEBOARD_SITE_CANONICAL       canonical site host (default: www.sideboard.cloud)
 *
 * Desktop clients connect to wss://relay.sideboard.cloud/slack/desktop (or
 * SIDEBOARD_SLACK_RELAY_URL for local testing). GET /slack/callback exchanges
 * the Slack OAuth code. Desktops poll GET /slack/oauth/result?state=…
 * GET / on www.sideboard.cloud serves the marketing site. relay.sideboard.cloud
 * stays Slack + JSON. GET /health stays JSON for Fly checks.
 */
async function main(): Promise<void> {
  const appToken = process.env.SIDEBOARD_SLACK_APP_TOKEN?.trim() ?? '';
  if (!appToken) {
    console.error('Set SIDEBOARD_SLACK_APP_TOKEN to an xapp-… token with connections:write.');
    process.exit(1);
  }
  const clientSecret = process.env.SIDEBOARD_SLACK_CLIENT_SECRET?.trim() ?? '';
  if (!clientSecret) {
    console.error(
      'Set SIDEBOARD_SLACK_CLIENT_SECRET via `fly secrets set` (never commit it).',
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT || process.env.SIDEBOARD_SLACK_RELAY_PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const csv = (value: string | undefined, fallback: string[]): string[] => {
    const raw = value?.trim();
    if (!raw) return fallback;
    return raw.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  };
  const staticRoot =
    process.env.SIDEBOARD_SITE_ROOT?.trim() ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../site');
  const canonicalSiteHost =
    process.env.SIDEBOARD_SITE_CANONICAL?.trim().toLowerCase() || 'www.sideboard.cloud';
  const staticHosts = csv(process.env.SIDEBOARD_SITE_HOSTS, [canonicalSiteHost]);
  const redirectHosts = csv(process.env.SIDEBOARD_SITE_REDIRECT_HOSTS, ['sideboard.cloud']);

  const ac = new AbortController();
  const shutdown = () => ac.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const handle = await startSlackRelayServer({
    appToken,
    clientSecret,
    port,
    host,
    staticRoot,
    staticHosts,
    redirectHosts,
    canonicalSiteHost,
    signal: ac.signal,
    onLog: (line) => console.log(line),
  });

  const listenHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`sideboard-slack-relay ready · ${handle.url}`);
  console.log(`site · https://${canonicalSiteHost}/`);
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
