import { oauthReturnPage } from '../relay/oauth-return-page.js';

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

export const SLACK_OAUTH_REDIRECT = `https://relay.sideboard.build${SLACK_OAUTH_CALLBACK_PATH}`;

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

/** Slack OAuth return. Same Sideboard card as the git-host callback. */
export function slackOAuthHtmlPage(title: string, body: string): string {
  return oauthReturnPage(title, body);
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
