import { slackApi } from './api.js';

export const SLACK_APP_HOME_DOWNLOAD =
  'https://sideboard-downloads.t3.tigrisfiles.io/Sideboard-latest-arm64.dmg';
export const SLACK_APP_HOME_LANDING = 'https://www.sideboard.cloud/slack/';
export const SLACK_APP_HOME_PRIVACY = 'https://www.sideboard.cloud/privacy/';
export const SLACK_APP_HOME_SUPPORT = 'https://www.sideboard.cloud/support/';
export const SLACK_APP_HOME_SUPPORT_EMAIL = 'support@sideboard.cloud';

/** Posted in Slack when a DM/@mention arrives and no Mac is registered. */
export const SLACK_NO_MAC_ONLINE_REPLY = [
  'No Sideboard Mac is online for your Slack user.',
  'Open Sideboard → Settings → Remote and wait for Relay connected.',
  'Keep the Mac awake (Settings → Advanced → Caffeinate while Slack Listen is on).',
  'Then send this again.',
  '',
  `Download: ${SLACK_APP_HOME_LANDING}`,
  `Support: ${SLACK_APP_HOME_SUPPORT_EMAIL}`,
].join('\n');

export interface SlackAppHomeViewOpts {
  online?: boolean;
  deviceLabel?: string;
}

export function slackAppHomeView(opts?: SlackAppHomeViewOpts): {
  type: 'home';
  blocks: Array<Record<string, unknown>>;
} {
  const online = Boolean(opts?.online);
  const label = opts?.deviceLabel?.trim();
  const status = online
    ? label
      ? `Your Mac *${label}* is connected. DM @Sideboard (or \`@Sideboard ${label.toLowerCase()}: …\` in a channel) to talk to it.`
      : 'Your Mac is connected. DM @Sideboard to talk to it.'
    : [
        'Agents run on *your Mac*, not in Slack’s cloud. The relay only carries message text — not repos, secrets, or a downloadable shell script.',
        '',
        '*First run*',
        '1. Download Sideboard for Apple Silicon and keep it open.',
        '2. Settings → Remote → Slack → Add via browser. Name this Mac (`Work`, `Personal`, …).',
        '3. Wait until status shows Relay connected, then DM @Sideboard.',
      ].join('\n');

  return {
    type: 'home',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Sideboard', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: status },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Download for Mac', emoji: true },
            url: SLACK_APP_HOME_DOWNLOAD,
            action_id: 'sideboard_download_mac',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Setup guide', emoji: true },
            url: SLACK_APP_HOME_LANDING,
            action_id: 'sideboard_setup_guide',
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `Support: ${SLACK_APP_HOME_SUPPORT_EMAIL} · <${SLACK_APP_HOME_SUPPORT}|Support page> · <${SLACK_APP_HOME_PRIVACY}|Privacy>`,
            'Agents (Claude Code, Codex, OpenCode, Cursor) can be inaccurate — double-check replies. Slack text is not used to train Sideboard models; Sideboard does not host a model.',
          ].join('\n'),
        },
      },
    ],
  };
}

export async function publishSlackAppHome(opts: {
  token: string;
  userId: string;
  online?: boolean;
  deviceLabel?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const userId = opts.userId.trim();
  if (!userId) return;
  await slackApi(
    opts.token,
    'views.publish',
    {
      user_id: userId,
      view: JSON.stringify(slackAppHomeView(opts)),
    },
    opts.fetchImpl,
  );
}
