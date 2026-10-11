import { MarkdownIt } from 'react-native-markdown-display';

/**
 * Phone chat parser. `linkify` turns bare http(s) URLs and emails into links,
 * the same autolink pass desktop chat gets from remark-gfm. Typographer stays
 * on so quotes match the previous renderer.
 */
export const chatMarkdown = MarkdownIt({
  typographer: true,
  linkify: true,
});
