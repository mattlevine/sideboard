import { parser, type ASTNode } from 'react-native-markdown-display';
import { linkifyChatUrls } from './chat-link';
import { chatMarkdown } from './chat-markdown';
import { visibleFindParts, type FindPartNode } from './find-parts';

function asFindNodes(nodes: ASTNode[]): FindPartNode[] {
  return nodes.map((node) => ({
    type: node.type,
    content: node.content,
    sourceInfo: (node as ASTNode & { sourceInfo?: string }).sourceInfo,
    children: node.children?.length ? asFindNodes(node.children) : [],
  }));
}

/** Visible chat strings for one message, in the same order MarkdownText paints them. */
export function paintedFindStrings(source: string): string[] {
  const ast = parser(linkifyChatUrls(source), (tree) => tree as never, chatMarkdown);
  if (!Array.isArray(ast)) return [];
  return visibleFindParts(asFindNodes(ast as ASTNode[]));
}
