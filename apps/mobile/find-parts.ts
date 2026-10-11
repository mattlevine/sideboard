import { parseFilePathLink } from './file-link';

/** One markdown node the phone renderer walks. `sourceInfo` is the fence info string. */
export type FindPartNode = {
  type: string;
  content?: string;
  sourceInfo?: string;
  children?: FindPartNode[];
};

/** First fence info token, matching fenceLanguage in code-highlight.ts. */
function fenceInfo(info: string | undefined): string {
  return (info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function fenceText(content: string | undefined): string {
  return String(content ?? '').replace(/\n$/, '');
}

/**
 * Strings paintFind will highlight, in render order.
 * Mermaid source, image alt, and link URLs are not drawn as text, so they are omitted.
 * File chips and artifact titles are the labels on screen.
 */
export function visibleFindParts(nodes: FindPartNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FindPartNode[]) => {
    for (const node of list) {
      if (node.type === 'fence') {
        const content = fenceText(node.content);
        const language = fenceInfo(node.sourceInfo);
        if (language === 'sb-artifact') {
          out.push(content.split('\n')[0]?.trim() || 'Artifact');
          continue;
        }
        const file = parseFilePathLink(language);
        if (file) {
          out.push(file.path);
          continue;
        }
        if (language === 'mermaid') continue;
        out.push(content);
        continue;
      }
      if (node.type === 'code_block') {
        out.push(fenceText(node.content));
        continue;
      }
      if (node.type === 'code_inline') {
        out.push(String(node.content ?? ''));
        continue;
      }
      if (node.type === 'image') continue;
      if (node.type === 'text') {
        out.push(String(node.content ?? ''));
        continue;
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
