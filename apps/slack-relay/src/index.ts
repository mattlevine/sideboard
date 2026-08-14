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
 *
 * Desktop clients connect to wss://relay.sideboard.cloud/slack/desktop (or
 * SIDEBOARD_SLACK_RELAY_URL for local testing). GET /slack/callback exchanges
 * the Slack OAuth code. Desktops poll GET /slack/oauth/result?state=…
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

  const ac = new AbortController();
  const shutdown = () => ac.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const handle = await startSlackRelayServer({
    appToken,
    clientSecret,
    port,
    host,
    signal: ac.signal,
    onLog: (line) => console.log(line),
  });

  console.log(`sideboard-slack-relay ready · ${handle.url}`);
  console.log(`health · http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${handle.port}/health`);

  await new Promise<void>((resolve) => {
    ac.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  await handle.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
