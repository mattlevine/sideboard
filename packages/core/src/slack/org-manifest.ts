import { SLACK_BOT_SCOPES } from './oauth.js';

const BOT_EVENTS = [
  'app_home_opened',
  'app_mention',
  'app_uninstalled',
  'message.im',
  'message.mpim',
];

function yamlList(scopes: string, indent: string): string {
  return scopes
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .map((scope) => `${indent}- ${scope}`)
    .join('\n');
}

/**
 * Slack app manifest for one company. The events path is public.
 * Secrets are not included; Slack issues those after the app is created.
 */
export function slackOrgManifest(opts: { eventsUrl: string; redirectUrl: string }): string {
  const eventsUrl = opts.eventsUrl.trim();
  const redirectUrl = opts.redirectUrl.trim();
  return `display_information:
  name: Sideboard
  description: Drive Sideboard agents from Slack DMs and @mentions.
  background_color: "#111827"
  long_description: >-
    Sideboard sends DMs and @mentions to the orchestrator on a Mac in this
    workspace and posts replies back in thread. Agents can list, read, and
    post in Slack. Message text is not used to train models.

features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Sideboard
    always_online: true

oauth_config:
  redirect_urls:
    - ${redirectUrl}
  scopes:
    bot:
${yamlList(SLACK_BOT_SCOPES, '      ')}

settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
  event_subscriptions:
    request_url: ${eventsUrl}
    bot_events:
${BOT_EVENTS.map((event) => `      - ${event}`).join('\n')}
`;
}

export function slackEventsPath(registrationId: string): string {
  return `/slack/events/${registrationId}`;
}

export function slackEventsUrl(origin: string, registrationId: string): string {
  return `${origin.replace(/\/$/, '')}${slackEventsPath(registrationId)}`;
}
