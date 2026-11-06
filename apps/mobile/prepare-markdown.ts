import { normalizeMarkdownTables } from '../desktop/src/renderer/src/lib/normalize-markdown-tables';
import { slackMrkdwnToMarkdown } from '../desktop/src/renderer/src/lib/slack-mrkdwn-to-markdown';
import { linkifyChatUrls } from './chat-link';

/**
 * Same prep the desktop chat bubble applies before remark-gfm:
 * Slack mrkdwn, bare sideboard links, then short table delimiters.
 */
export function preparePhoneMarkdown(text: string): string {
  return normalizeMarkdownTables(linkifyChatUrls(slackMrkdwnToMarkdown(text)));
}
