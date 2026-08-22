/**
 * Slack listen replies are posted as mrkdwn (`<url|label>`, `•` lists). The same
 * text is stored in the orchestration transcript. Convert those to CommonMark so
 * the board does not show raw angle-bracket markup or a wrapped bullet paragraph.
 *
 * Slack treats a single newline as a line break; CommonMark collapses it. After
 * converting links and `•` lists, keep those breaks (and split a same-line run of
 * PR links that Slack wraps).
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
 * Slack list marker is `•` (typed `-`/`*` in the client). CommonMark only
 * treats `-` / `*` / `+` as lists, so a `•` run becomes one wrapped paragraph.
 */
function slackBulletsToMarkdownLists(chunk: string): string {
  const parts = chunk.split(/(`[^`\n]+`)/);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (i % 2 === 1) {
      out += part;
      continue;
    }
    const midLine = out.length > 0 && !out.endsWith('\n');
    let s = midLine ? part.replace(/^[ \t]*•[ \t]+/, '\n- ') : part;
    s = s.replace(/^[ \t]*•[ \t]+/gm, '- ').replace(/([^\n])[ \t]+•[ \t]+/g, '$1\n- ');
    out += s;
  }
  return out;
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

function looksLikeSlackMrkdwn(text: string): boolean {
  return SLACK_HTTP_LINK_RE.test(text) || /(?:^|[\s])•\s/.test(text);
}

export function slackMrkdwnToMarkdown(text: string): string {
  if (!looksLikeSlackMrkdwn(text)) return text;
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const linked = mapOutsideInlineCode(part, convertSlackLinks);
      const listed = slackBulletsToMarkdownLists(linked);
      return slackNewlinesToHardBreaks(breakAfterInlineCodeBeforeLink(listed));
    })
    .join('');
}
