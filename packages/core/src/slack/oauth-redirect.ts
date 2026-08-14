/**
 * Slack-registered redirect URI (HTTPS). Provider paths are namespaced under
 * `/slack/…` so the same host can serve other OAuth relays later.
 * The hosted relay exchanges the code — the Mac never sees the client secret.
 */
export const SLACK_OAUTH_CALLBACK_PATH = '/slack/callback';
export const SLACK_OAUTH_RESULT_PATH = '/slack/oauth/result';
export const SLACK_RELAY_DESKTOP_PATH = '/slack/desktop';
export const SLACK_OAUTH_LOCAL_PORT = 19847;
/** Local callback — namespaced so one port can also host `/linear/callback`, etc. */
export const SLACK_OAUTH_LOCAL_CALLBACK = `http://127.0.0.1:${SLACK_OAUTH_LOCAL_PORT}${SLACK_OAUTH_CALLBACK_PATH}`;

export const SLACK_OAUTH_REDIRECT = `https://relay.sideboard.cloud${SLACK_OAUTH_CALLBACK_PATH}`;

/** @deprecated Use SLACK_OAUTH_CALLBACK_PATH */
export const SLACK_OAUTH_BOUNCE_PATH = SLACK_OAUTH_CALLBACK_PATH;

export function slackOAuthRedirectUri(): string {
  return process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT?.trim() || SLACK_OAUTH_REDIRECT;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function slackOAuthHtmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:48px 24px;max-width:36rem;margin:0 auto;color:#1a1a1a}
h1{font-size:1.25rem}p{line-height:1.5;color:#444}</style></head><body>${body}</body></html>`;
}

export function parseSlackOAuthCallbackUrl(reqUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(reqUrl, SLACK_OAUTH_REDIRECT);
  } catch {
    return null;
  }
  if (url.pathname !== SLACK_OAUTH_CALLBACK_PATH) return null;
  return url;
}

export function parseSlackOAuthResultUrl(reqUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(reqUrl, SLACK_OAUTH_REDIRECT);
  } catch {
    return null;
  }
  if (url.pathname !== SLACK_OAUTH_RESULT_PATH) return null;
  return url;
}
