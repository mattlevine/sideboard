import type { IncomingMessage, ServerResponse } from 'node:http';
import { escapeHtml, slackOAuthHtmlPage } from '../slack/oauth-redirect.js';
import {
  exchangeSlackOAuthCode,
  SlackOAuthPendingStore,
  type SlackOAuthTokenPayload,
} from '../slack/oauth-exchange.js';
import { clientIdFromOAuthState } from '../slack/oauth-state.js';
import {
  inboundFromEventsBody,
  lifecycleFromEventsBody,
  parseSlackEventsBody,
  SlackEventDeduper,
  verifySlackRequestSignature,
} from '../slack/events-api.js';
import { slackEventsUrl, slackOrgManifest } from '../slack/org-manifest.js';
import type { SlackListenGrants } from '../slack/listen-grant.js';
import type { SlackRelayHub } from '../slack/relay-hub.js';
import type { RelayAccountStore } from './accounts.js';
import type { SlackAppStore } from './slack-apps.js';

const EVENTS_PREFIX = '/slack/events/';
const APPS_PATH = '/slack/apps';
const BODY_LIMIT = 262_144;

export interface SlackHttpContext {
  req: IncomingMessage;
  res: ServerResponse;
  reqUrl: string;
  accounts: RelayAccountStore | null;
  apps: SlackAppStore | null;
  hub: SlackRelayHub;
  grants: SlackListenGrants;
  pending: SlackOAuthPendingStore;
  bakedClientId: string;
  bakedClientSecret: string;
  redirectUri: string;
  publicOrigin: string;
  fetchImpl?: typeof fetch;
  dedupe: SlackEventDeduper;
  log: (line: string) => void;
}

/** Company Slack apps, Events API, and the OAuth callback. Returns true when handled. */
export async function handleSlackHttp(ctx: SlackHttpContext): Promise<boolean> {
  const url = parseUrl(ctx.reqUrl);
  if (!url) return false;
  const path = url.pathname;
  if (path === '/slack/callback') return handleCallback(ctx, url);
  if (path === '/slack/oauth/result') return handleResult(ctx, url);
  if (path === APPS_PATH && ctx.req.method === 'POST') {
    await handleCreate(ctx);
    return true;
  }
  const creds = path.match(/^\/slack\/apps\/([A-Za-z0-9_-]+)\/credentials$/);
  if (creds && ctx.req.method === 'POST') {
    await handleCredentials(ctx, creds[1]!);
    return true;
  }
  if (path.startsWith(EVENTS_PREFIX) && ctx.req.method === 'POST') {
    await handleEvents(ctx, decodeURIComponent(path.slice(EVENTS_PREFIX.length)));
    return true;
  }
  return false;
}

function parseUrl(reqUrl: string): URL | null {
  try {
    return new URL(reqUrl, 'http://127.0.0.1');
  } catch {
    return null;
  }
}

async function handleCreate(ctx: SlackHttpContext): Promise<void> {
  if (!ctx.accounts || !ctx.apps) {
    sendJson(ctx.res, 503, {
      ok: false,
      error: 'Per-company Slack apps need SIDEBOARD_SLACK_TOKEN_KEY and the relay account database',
    });
    return;
  }
  const accountId = ctx.accounts.verifyCredential(bearer(ctx.req));
  if (!accountId) {
    sendJson(ctx.res, 401, { ok: false, error: 'Sign in to the relay before creating a Slack app' });
    return;
  }
  const created = ctx.apps.create(accountId);
  const eventsUrl = slackEventsUrl(ctx.publicOrigin, created.registrationId);
  sendJson(ctx.res, 200, {
    ok: true,
    registrationId: created.registrationId,
    writeToken: created.writeToken,
    eventsUrl,
    manifest: slackOrgManifest({ eventsUrl, redirectUrl: ctx.redirectUri }),
  });
}

async function handleCredentials(ctx: SlackHttpContext, registrationId: string): Promise<void> {
  if (!ctx.apps) {
    sendJson(ctx.res, 503, { ok: false, error: 'Per-company Slack apps are off on this relay' });
    return;
  }
  const body = await readJson(ctx.req);
  const writeToken = stringField(body, 'writeToken');
  const clientId = stringField(body, 'clientId');
  const clientSecret = stringField(body, 'clientSecret');
  const signingSecret = stringField(body, 'signingSecret');
  try {
    ctx.apps.saveCredentials(registrationId, writeToken, { clientId, clientSecret, signingSecret });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(ctx.res, 400, { ok: false, error: message });
    return;
  }
  sendJson(ctx.res, 200, { ok: true });
}

async function handleEvents(ctx: SlackHttpContext, registrationId: string): Promise<void> {
  if (!ctx.apps) {
    sendJson(ctx.res, 503, { ok: false, error: 'Per-company Slack apps are off on this relay' });
    return;
  }
  const app = ctx.apps.getByRegistration(registrationId);
  if (!app) {
    sendJson(ctx.res, 404, { ok: false, error: 'Unknown Slack app' });
    return;
  }
  const raw = await readBody(ctx.req);
  const body = parseSlackEventsBody(raw);
  if (!body) {
    sendJson(ctx.res, 400, { ok: false, error: 'Invalid JSON' });
    return;
  }
  if (body.type === 'url_verification') {
    if (app.signingSecret && !signed(ctx, app.signingSecret, raw)) {
      sendJson(ctx.res, 401, { ok: false, error: 'Bad signature' });
      return;
    }
    const challenge = typeof body.challenge === 'string' ? body.challenge : '';
    sendJson(ctx.res, 200, { challenge });
    return;
  }
  if (body.type !== 'event_callback') {
    sendJson(ctx.res, 200, { ok: true });
    return;
  }
  if (!app.signingSecret || !signed(ctx, app.signingSecret, raw)) {
    sendJson(ctx.res, 401, { ok: false, error: 'Bad signature' });
    return;
  }
  const teamId = typeof body.team_id === 'string' ? body.team_id.trim() : '';
  if (app.teamId && teamId && teamId !== app.teamId) {
    sendJson(ctx.res, 401, { ok: false, error: 'Slack team does not match this app' });
    return;
  }
  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  if (ctx.dedupe.duplicate(eventId)) {
    sendJson(ctx.res, 200, { ok: true });
    return;
  }
  sendJson(ctx.res, 200, { ok: true });
  if (!app.teamId) {
    ctx.log(`slack event ${eventId || '?'} before install for ${registrationId}`);
    return;
  }
  const life = lifecycleFromEventsBody(body);
  if (life?.kind === 'app_uninstalled') {
    ctx.apps.clearInstall(life.teamId);
    ctx.grants.revokeTeam(life.teamId);
    ctx.hub.uninstallTeam(life.teamId);
    return;
  }
  if (life?.kind === 'app_home_opened') {
    void ctx.hub.handleAppHomeOpened(life.teamId, life.userId);
    return;
  }
  const inbound = inboundFromEventsBody(body);
  if (inbound) ctx.hub.routeEvent(inbound);
}

function signed(ctx: SlackHttpContext, signingSecret: string, raw: string): boolean {
  const timestamp = header(ctx.req, 'x-slack-request-timestamp');
  const signature = header(ctx.req, 'x-slack-signature');
  return verifySlackRequestSignature({ signingSecret, timestamp, rawBody: raw, signature });
}

async function handleCallback(ctx: SlackHttpContext, url: URL): Promise<boolean> {
  const error = url.searchParams.get('error')?.trim();
  const state = url.searchParams.get('state')?.trim() ?? '';
  const code = url.searchParams.get('code')?.trim() ?? '';
  if (error) {
    if (state) ctx.pending.put(state, { ok: false, error: `Slack OAuth: ${error}` });
    sendHtml(ctx.res, 400, 'Slack', `<h1>Authorization cancelled</h1><p>${escapeHtml(error)}</p>`);
    return true;
  }
  if (!state || !code) {
    sendHtml(ctx.res, 400, 'Slack', '<h1>Invalid callback</h1><p>State or code missing.</p>');
    return true;
  }
  try {
    const creds = resolveOAuthClient(ctx, state);
    const payload = await exchangeSlackOAuthCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code,
      redirectUri: ctx.redirectUri,
      fetchImpl: ctx.fetchImpl,
    });
    if (ctx.apps && payload.bot_token) {
      ctx.apps.recordInstall({
        clientId: creds.clientId,
        teamId: payload.team_id,
        botToken: payload.bot_token,
        botUserId: payload.bot_user_id ?? '',
      });
    }
    const listenGrant = payload.user_id ? ctx.grants.issue(payload.team_id, payload.user_id) : null;
    ctx.pending.put(state, {
      ok: true,
      payload: publicPayload({
        ...payload,
        ...(listenGrant ? { listen_grant: listenGrant } : {}),
      }),
    });
    if (payload.bot_token) {
      ctx.hub.rememberBot(payload.team_id, payload.bot_token);
      if (payload.user_id) void ctx.hub.handleAppHomeOpened(payload.team_id, payload.user_id);
    }
    sendHtml(
      ctx.res,
      200,
      'Slack connected',
      '<h1>Slack workspace connected</h1><p>Open <strong>Sideboard → Settings → Collaboration</strong>. Confirm Relay connected on Settings → Remote, name this Mac, then DM @Sideboard.</p>',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.pending.put(state, { ok: false, error: message });
    sendHtml(ctx.res, 400, 'Slack', `<h1>Could not connect Slack</h1><p>${escapeHtml(message)}</p>`);
  }
  return true;
}

function resolveOAuthClient(
  ctx: SlackHttpContext,
  state: string,
): { clientId: string; clientSecret: string } {
  const fromState = clientIdFromOAuthState(state);
  if (!fromState) {
    if (!ctx.bakedClientSecret) throw new Error('Relay is missing SIDEBOARD_SLACK_CLIENT_SECRET');
    return { clientId: ctx.bakedClientId, clientSecret: ctx.bakedClientSecret };
  }
  const secret = ctx.apps?.clientSecretFor(fromState);
  if (!secret) throw new Error('This Slack app is not registered on the relay');
  return { clientId: fromState, clientSecret: secret };
}

function publicPayload(payload: SlackOAuthTokenPayload): SlackOAuthTokenPayload {
  return {
    team_id: payload.team_id,
    team_name: payload.team_name,
    user_id: payload.user_id,
    bot_token: payload.bot_token,
    user_token: payload.user_token,
    listen_grant: payload.listen_grant,
    scopes: payload.scopes,
  };
}

function handleResult(ctx: SlackHttpContext, url: URL): boolean {
  const state = url.searchParams.get('state')?.trim() ?? '';
  const value = ctx.pending.take(state);
  if (!value) {
    sendJson(ctx.res, 404, { ok: false, error: 'pending' });
    return true;
  }
  if (!value.ok) {
    sendJson(ctx.res, 400, { ok: false, error: value.error });
    return true;
  }
  sendJson(ctx.res, 200, { ok: true, ...value.payload });
  return true;
}

function bearer(req: IncomingMessage): string {
  const value = header(req, 'authorization');
  const match = /^Bearer\s+(\S+)/i.exec(value);
  return match?.[1]?.trim() ?? '';
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === 'string' ? value.trim() : '';
}

function stringField(body: Record<string, unknown> | null, key: string): string {
  const value = body?.[key];
  return typeof value === 'string' ? value : '';
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const raw = await readBody(req);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(slackOAuthHtmlPage(title, body));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
