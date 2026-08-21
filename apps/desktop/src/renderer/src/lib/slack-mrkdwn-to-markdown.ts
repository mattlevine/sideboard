/**
 * Slack listen replies are posted as mrkdwn (`<url|label>`). The same text is
 * stored in the orchestration transcript. Convert those links to CommonMark so
 * the board does not show raw angle-bracket markup.
 *
 * Leaves Slack mentions (`<@U…>`, `<#C…>`, `<!here>`) and fenced/inline code alone.
 */

const SLACK_LABELED_LINK_RE = /<((?:https?|mailto):[^|>\s]+)\|([^>\n]+)>/gi;
const SLACK_BARE_LINK_RE = /<((?:https?|mailto):[^|>\s]+)>/gi;

function convertSlackLinks(chunk: string): string {
  return chunk
    .replace(SLACK_LABELED_LINK_RE, '[$2]($1)')
    .replace(SLACK_BARE_LINK_RE, '$1');
}

function mapOutsideInlineCode(chunk: string, fn: (s: string) => string): string {
  return chunk
    .split(/(`[^`\n]+`)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

export function slackMrkdwnToMarkdown(text: string): string {
  if (!text.includes('<')) return text;
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return mapOutsideInlineCode(part, convertSlackLinks);
    })
    .join('');
}
