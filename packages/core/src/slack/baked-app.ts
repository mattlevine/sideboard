/**
 * Official Sideboard Slack app (api.slack.com/apps).
 * Used when env / Account overrides are empty so **Add via browser** works
 * without each user creating a Slack app.
 *
 * Client ID is public. Client Secret ships in the desktop binary and can be
 * extracted — native Slack OAuth tradeoff so we can request bot scopes on
 * localhost. Do not put the app-level `xapp-` token here.
 *
 * Relay URL is public (not a secret). The hosted relay holds the one xapp-
 * and forwards each team's events to the matching desktop.
 */
export const BAKED_SLACK_CLIENT_ID = '7592788819232.11813536272562';
export const BAKED_SLACK_CLIENT_SECRET = '10290abf6ad0dc11fe6fc321a6215299';

/** Public WebSocket URL for the hosted Slack inbound relay (path included). */
export const BAKED_SLACK_RELAY_URL = 'wss://slack-relay.sideboard.cloud/desktop';

export function hasBakedSlackOAuth(): boolean {
  return Boolean(BAKED_SLACK_CLIENT_ID.trim() && BAKED_SLACK_CLIENT_SECRET.trim());
}

/**
 * Relay URL for inbound Slack when this Mac has no local xapp-.
 * Override with SIDEBOARD_SLACK_RELAY_URL for local relay testing.
 */
export function slackRelayUrl(): string {
  return (
    process.env.SIDEBOARD_SLACK_RELAY_URL?.trim() ||
    BAKED_SLACK_RELAY_URL.trim()
  );
}
