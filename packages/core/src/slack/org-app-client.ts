import { slackRelayHttpOrigin } from './oauth-exchange.js';
import { slackRelayUrl } from './baked-app.js';

export interface SlackOrgRegistration {
  registrationId: string;
  writeToken: string;
  eventsUrl: string;
  manifest: string;
}

function originOf(relayWsUrl?: string): string {
  return slackRelayHttpOrigin(relayWsUrl ?? slackRelayUrl());
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error?.trim()) return body.error.trim();
  } catch {
    // fall through
  }
  return `Relay returned ${res.status}`;
}

/** Ask the signed-in relay account for a company Slack app manifest. */
export async function createSlackOrgApp(opts: {
  accountToken: string;
  relayWsUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOrgRegistration> {
  const token = opts.accountToken.trim();
  if (!token) throw new Error('Sign in on Settings → Remote before creating a Slack app');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${originOf(opts.relayWsUrl)}/slack/apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as Partial<SlackOrgRegistration> & { ok?: boolean };
  if (!body.registrationId || !body.writeToken || !body.manifest || !body.eventsUrl) {
    throw new Error('Relay did not return a Slack app registration');
  }
  return {
    registrationId: body.registrationId,
    writeToken: body.writeToken,
    eventsUrl: body.eventsUrl,
    manifest: body.manifest,
  };
}

/** Upload the secrets Slack showed after the manifest was imported. */
export async function saveSlackOrgCredentials(opts: {
  registrationId: string;
  writeToken: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  relayWsUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${originOf(opts.relayWsUrl)}/slack/apps/${encodeURIComponent(opts.registrationId)}/credentials`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writeToken: opts.writeToken,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        signingSecret: opts.signingSecret,
      }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}
