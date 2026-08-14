import { describe, expect, it } from 'vitest';
import {
  SLACK_OAUTH_BOUNCE_PATH,
  SLACK_OAUTH_LOCAL_CALLBACK,
  SLACK_OAUTH_REDIRECT,
  slackOAuthBounceResponse,
  slackOAuthRedirectUri,
} from './oauth-redirect.js';

describe('Slack OAuth HTTPS bounce', () => {
  it('registers an https redirect on the hosted relay', () => {
    expect(SLACK_OAUTH_REDIRECT).toBe('https://slack-relay.sideboard.cloud/callback');
    expect(SLACK_OAUTH_REDIRECT.startsWith('https://')).toBe(true);
    expect(SLACK_OAUTH_BOUNCE_PATH).toBe('/callback');
    expect(SLACK_OAUTH_LOCAL_CALLBACK).toBe('http://127.0.0.1:19847/callback');
  });

  it('bounces code and state to localhost', () => {
    const res = slackOAuthBounceResponse('/callback?code=abc&state=xyz&extra=drop');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    expect(res!.headers.Location).toBe('http://127.0.0.1:19847/callback?code=abc&state=xyz');
    expect(res!.body).toContain('http://127.0.0.1:19847/callback?code=abc&amp;state=xyz');
  });

  it('forwards Slack error params', () => {
    const res = slackOAuthBounceResponse('/callback?error=access_denied&state=s1');
    const loc = new URL(res!.headers.Location);
    expect(loc.origin + loc.pathname).toBe('http://127.0.0.1:19847/callback');
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('s1');
  });

  it('ignores other paths', () => {
    expect(slackOAuthBounceResponse('/health')).toBeNull();
    expect(slackOAuthBounceResponse('/desktop')).toBeNull();
    expect(slackOAuthBounceResponse('/')).toBeNull();
  });

  it('SIDEBOARD_SLACK_OAUTH_REDIRECT overrides the registered URI', () => {
    const prev = process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT;
    process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT = 'http://127.0.0.1:19847/callback';
    try {
      expect(slackOAuthRedirectUri()).toBe('http://127.0.0.1:19847/callback');
    } finally {
      if (prev === undefined) delete process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT;
      else process.env.SIDEBOARD_SLACK_OAUTH_REDIRECT = prev;
    }
  });
});
