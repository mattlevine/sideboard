import { describe, expect, it } from 'vitest';
import {
  SLACK_OAUTH_CALLBACK_PATH,
  SLACK_OAUTH_LOCAL_CALLBACK,
  SLACK_OAUTH_REDIRECT,
  SLACK_OAUTH_RESULT_PATH,
  SLACK_RELAY_DESKTOP_PATH,
  parseSlackOAuthCallbackUrl,
  parseSlackOAuthResultUrl,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';
import { slackOAuthResultUrl, slackRelayHttpOrigin } from './oauth-exchange.js';

describe('Slack OAuth HTTPS callback', () => {
  it('registers an https redirect on the hosted relay under /slack', () => {
    expect(SLACK_OAUTH_REDIRECT).toBe('https://relay.sideboard.cloud/slack/callback');
    expect(SLACK_OAUTH_REDIRECT.startsWith('https://')).toBe(true);
    expect(SLACK_OAUTH_CALLBACK_PATH).toBe('/slack/callback');
    expect(SLACK_OAUTH_LOCAL_CALLBACK).toBe('http://127.0.0.1:19847/slack/callback');
    expect(SLACK_OAUTH_RESULT_PATH).toBe('/slack/oauth/result');
    expect(SLACK_RELAY_DESKTOP_PATH).toBe('/slack/desktop');
  });

  it('parses callback query without treating other paths as OAuth', () => {
    const url = parseSlackOAuthCallbackUrl('/slack/callback?code=abc&state=xyz&extra=drop');
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('code')).toBe('abc');
    expect(url!.searchParams.get('state')).toBe('xyz');
    expect(parseSlackOAuthCallbackUrl('/callback?code=abc&state=xyz')).toBeNull();
    expect(parseSlackOAuthCallbackUrl('/linear/callback?code=abc&state=xyz')).toBeNull();
    expect(parseSlackOAuthCallbackUrl('/health')).toBeNull();
    expect(parseSlackOAuthCallbackUrl('/slack/desktop')).toBeNull();
    expect(parseSlackOAuthCallbackUrl('/')).toBeNull();
  });

  it('parses oauth result state', () => {
    const url = parseSlackOAuthResultUrl('/slack/oauth/result?state=s1');
    expect(url?.searchParams.get('state')).toBe('s1');
    expect(parseSlackOAuthResultUrl('/oauth/result?state=s1')).toBeNull();
    expect(parseSlackOAuthResultUrl('/slack/callback')).toBeNull();
  });

  it('SIDEBOARD_SLACK_OAUTH_REDIRECT overrides the registered URI', () => {
    const prev = process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT;
    process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT = 'http://127.0.0.1:19847/slack/callback';
    try {
      expect(slackOAuthRedirectUri()).toBe('http://127.0.0.1:19847/slack/callback');
    } finally {
      if (prev === undefined) delete process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT;
      else process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT = prev;
    }
  });

  it('maps the desktop WebSocket URL to the HTTP result origin', () => {
    expect(slackRelayHttpOrigin('wss://relay.sideboard.cloud/slack/desktop')).toBe(
      'https://relay.sideboard.cloud',
    );
    expect(slackOAuthResultUrl('abc', 'ws://127.0.0.1:8787/slack/desktop')).toBe(
      'http://127.0.0.1:8787/slack/oauth/result?state=abc',
    );
  });
});
