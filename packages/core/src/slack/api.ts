const SLACK_API = 'https://slack.com/api';

export class SlackApiError extends Error {
  constructor(
    public method: string,
    public slackError: string,
  ) {
    super(`Slack ${method}: ${slackError}`);
    this.name = 'SlackApiError';
  }
}

export async function slackApi<T extends object>(
  token: string,
  method: string,
  params?: Record<string, string | number | boolean | undefined>,
  fetchImpl?: typeof fetch,
): Promise<T> {
  const doFetch = fetchImpl ?? fetch;
  const body = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      body.set(key, String(value));
    }
  }
  const res = await doFetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!json.ok) {
    throw new SlackApiError(method, json.error || `HTTP ${res.status}`);
  }
  return json;
}

export interface SlackAuthTest {
  ok: boolean;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

export async function slackAuthTest(token: string): Promise<SlackAuthTest> {
  return slackApi<SlackAuthTest>(token, 'auth.test');
}
