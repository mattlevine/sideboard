/**
 * Official Sideboard Slack app (api.slack.com/apps).
 * Used when env / Account overrides are empty so **Add via browser** works
 * without each user creating a Slack app.
 *
 * Client ID is public. The Client Secret lives on the hosted relay
 * (`SIDEBOARD_SLACK_CLIENT_SECRET`) and is never shipped in git or the DMG.
 * Do not put the app-level `xapp-` token here either.
 *
 * Relay URL is public (not a secret). The hosted relay holds the xapp- token
 * and the OAuth client secret, and forwards each team's events to the matching
 * desktop.
 */
export const BAKED_SLACK_CLIENT_ID = '7592788819232.11813536272562';

/** Public WebSocket URL for the hosted Slack inbound relay (path included). */
export const BAKED_SLACK_RELAY_URL = 'wss://relay.sideboard.cloud/slack/desktop';

export function hasBakedSlackOAuth(): boolean {
  return Boolean(BAKED_SLACK_CLIENT_ID.trim());
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
