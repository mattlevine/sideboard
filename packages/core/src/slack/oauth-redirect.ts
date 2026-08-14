/** Fixed port so the desktop can listen on one localhost callback. */
export const SLACK_OAUTH_PORT = 19847;

/** Local listener. Slack never redirects here — HTTP is not allowed for public distribution. */
export const SLACK_OAUTH_LOCAL_CALLBACK = `http://127.0.0.1:${SLACK_OAUTH_PORT}/callback`;

/**
 * Slack-registered redirect URI (HTTPS). The hosted relay bounces to
 * {@link SLACK_OAUTH_LOCAL_CALLBACK} so the desktop can finish OAuth.
 */
export const SLACK_OAUTH_REDIRECT = 'https://slack-relay.sideboard.cloud/callback';

export const SLACK_OAUTH_BOUNCE_PATH = '/callback';

const BOUNCE_PARAMS = ['code', 'state', 'error', 'error_description'] as const;

export function slackOAuthRedirectUri(): string {
  return process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT?.trim() || SLACK_OAUTH_REDIRECT;
}

export function slackOAuthLocalBounceTarget(params: URLSearchParams): string {
  const dest = new URL(SLACK_OAUTH_LOCAL_CALLBACK);
  for (const key of BOUNCE_PARAMS) {
    const value = params.get(key);
    if (value) dest.searchParams.set(key, value);
  }
  return dest.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function slackOAuthBounceHtml(target: string): string {
  const safe = escapeHtml(target);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>Connecting Slack</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}a{color:#111}</style>
<script>location.replace(${JSON.stringify(target)})</script>
</head><body><h1>Connecting Slack</h1><p>Returning to Sideboard… <a href="${safe}">Continue</a></p></body></html>`;
}

/** HTTPS bounce for the hosted relay. `reqUrl` is the incoming path + query. */
export function slackOAuthBounceResponse(reqUrl: string): {
  status: number;
  headers: Record<string, string>;
  body: string;
} | null {
  let url: URL;
  try {
    url = new URL(reqUrl, SLACK_OAUTH_REDIRECT);
  } catch {
    return null;
  }
  if (url.pathname !== SLACK_OAUTH_BOUNCE_PATH) return null;
  const target = slackOAuthLocalBounceTarget(url.searchParams);
  return {
    status: 302,
    headers: {
      Location: target,
      'Content-Type': 'text/html; charset=utf-8',
    },
    body: slackOAuthBounceHtml(target),
  };
}
