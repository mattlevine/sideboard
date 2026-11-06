import { MarkdownIt } from 'react-native-markdown-display';
import { taskListPlugin } from './task-lists';

/**
 * Phone chat parser. `linkify` turns bare http(s) URLs and emails into links,
 * the same autolink pass desktop chat gets from remark-gfm. Task lists match
 * that GFM pass. Typographer stays on so quotes match the previous renderer.
 */
export const chatMarkdown = MarkdownIt({
  typographer: true,
  linkify: true,
}).use(taskListPlugin);
