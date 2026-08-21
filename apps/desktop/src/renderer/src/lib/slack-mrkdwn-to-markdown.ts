/**
 * Slack listen replies are posted as mrkdwn (`<url|label>`). The same text is
 * stored in the orchestration transcript. Convert those links to CommonMark so
 * the board does not show raw angle-bracket markup.
 *
 * Slack treats a single newline as a line break; CommonMark collapses it. After
 * converting links, keep those breaks (and split a same-line run of PR links
 * that Slack wraps).
 *
 * Leaves Slack mentions (`<@U…>`, `<#C…>`, `<!here>`) and fenced/inline code alone.
 */

const SLACK_HTTP_LINK_RE = /<(?:https?|mailto):[^|>\s]+(?:\|[^>\n]+)?>/i;

function convertSlackLinks(chunk: string): string {
  return chunk
    .replace(/<((?:https?|mailto):[^|>\s]+)\|([^>\n]+)>/gi, '[$2]($1)')
    .replace(/<((?:https?|mailto):[^|>\s]+)>/gi, '$1');
}

/** Slack `\n` → markdown hard break. Already-blank lines stay paragraphs. */
function slackNewlinesToHardBreaks(chunk: string): string {
  return chunk.replace(/(?<!  )\n(?!\n)/g, '  \n');
}

/**
 * Slack wraps each `<url|label>` visually. Coordinators often put
 * `→ `hash` <next-pr>` on one line; CommonMark keeps them inline.
 */
function breakAfterInlineCodeBeforeLink(chunk: string): string {
  return chunk.replace(/(`[^`\n]+`)[ \t]+(?=\[[^\]]+\]\([^)]+\))/g, '$1  \n');
}

function mapOutsideInlineCode(chunk: string, fn: (s: string) => string): string {
  return chunk
    .split(/(`[^`\n]+`)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

export function slackMrkdwnToMarkdown(text: string): string {
  if (!SLACK_HTTP_LINK_RE.test(text)) return text;
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const linked = mapOutsideInlineCode(part, convertSlackLinks);
      return slackNewlinesToHardBreaks(breakAfterInlineCodeBeforeLink(linked));
    })
    .join('');
}
