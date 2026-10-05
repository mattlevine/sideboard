import { describe, expect, it, vi } from 'vitest';
import {
  SLACK_APP_HOME_DOWNLOAD,
  SLACK_APP_HOME_LANDING,
  SLACK_APP_HOME_SUPPORT_EMAIL,
  SLACK_NO_MAC_ONLINE_REPLY,
  publishSlackAppHome,
  slackAppHomeView,
} from './app-home.js';

describe('Slack App Home', () => {
  it('offline view tells a new installer to download and DM the bot', () => {
    const view = slackAppHomeView();
    expect(view.type).toBe('home');
    const blob = JSON.stringify(view);
    expect(blob).toContain('Download Sideboard');
    expect(blob).toContain('Add via browser');
    expect(blob).toContain(SLACK_APP_HOME_DOWNLOAD);
    expect(blob).toContain(SLACK_APP_HOME_LANDING);
    expect(blob).toContain(SLACK_APP_HOME_SUPPORT_EMAIL);
    expect(blob).toContain('downloadable shell script');
    expect(blob).not.toContain('Your Mac *Work* is connected');
  });

  it('online view names the connected Mac', () => {
    const view = slackAppHomeView({ online: true, deviceLabel: 'Work' });
    expect(JSON.stringify(view)).toContain('Your Mac *Work* is connected');
  });

  it('no-Mac reply is a setup error, not a generic failure', () => {
    expect(SLACK_NO_MAC_ONLINE_REPLY).toMatch(/No Sideboard Mac is online/);
    expect(SLACK_NO_MAC_ONLINE_REPLY).toContain('Settings → Remote');
    expect(SLACK_NO_MAC_ONLINE_REPLY).toContain(SLACK_APP_HOME_SUPPORT_EMAIL);
  });

  it('publishes views.publish as a JSON view string', async () => {
    const posted: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ ok: true }));
    });
    await publishSlackAppHome({
      token: 'xoxb-bot',
      userId: 'U1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toContain('views.publish');
    expect(posted[0]!.body).toContain('user_id=U1');
    expect(posted[0]!.body).toContain('type');
    expect(decodeURIComponent(posted[0]!.body)).toContain('"type":"home"');
  });
});
