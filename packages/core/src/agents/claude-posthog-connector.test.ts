import { describe, expect, it } from 'vitest';
import { posthogConnectorFromList } from './claude-posthog-connector.js';

describe('posthogConnectorFromList', () => {
  it('builds a dynamic claude.ai proxy entry for PostHog', () => {
    expect(
      posthogConnectorFromList({
        data: [
          { id: 'mcpsrv_slack', display_name: 'Slack', url: 'https://mcp.slack.com/mcp' },
          {
            id: 'mcpsrv_posthog',
            display_name: 'PostHog',
            url: 'https://mcp.posthog.com/mcp',
            eligible: true,
          },
        ],
      }),
    ).toEqual({
      type: 'claudeai-proxy',
      id: 'mcpsrv_posthog',
      url: 'https://mcp-proxy.anthropic.com/v1/mcp/mcpsrv_posthog',
      displayName: 'PostHog',
      alwaysLoad: true,
    });
  });

  it('prefers the primary install and skips an ineligible row', () => {
    expect(
      posthogConnectorFromList({
        data: [
          { id: 'mcpsrv_extra', display_name: 'PostHog', additional_install: true },
          { id: 'mcpsrv_off', display_name: 'PostHog', eligible: false },
          { id: 'not an id', display_name: 'PostHog' },
          { id: 'mcpsrv_main', displayName: 'PostHog EU' },
        ],
      })?.id,
    ).toBe('mcpsrv_main');
  });

  it('returns null when PostHog is not connected', () => {
    expect(posthogConnectorFromList({ data: [{ id: 'mcpsrv_slack', display_name: 'Slack' }] })).toBe(
      null,
    );
  });
});
