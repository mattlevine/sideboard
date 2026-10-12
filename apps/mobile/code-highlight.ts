import { createElement, type ReactNode } from 'react';
import { Text } from 'react-native';
import { highlightHtml } from './code-language';

/** vs2015 token colors. Desktop paints the base text as --text (#ededed) on --bg. */
const CODE = '#ededed';
const COLORS: Record<string, string> = {
  'hljs-keyword': '#569CD6',
  'hljs-literal': '#569CD6',
  'hljs-symbol': '#569CD6',
  'hljs-name': '#569CD6',
  'hljs-link': '#569CD6',
  'hljs-built_in': '#4EC9B0',
  'hljs-type': '#4EC9B0',
  'hljs-number': '#B8D7A3',
  'hljs-class': '#B8D7A3',
  'hljs-string': '#D69D85',
  'hljs-regexp': '#9A5334',
  'hljs-template-tag': '#9A5334',
  'hljs-subst': '#DCDCDC',
  'hljs-function': '#DCDCDC',
  'hljs-title': '#DCDCDC',
  'hljs-params': '#DCDCDC',
  'hljs-formula': '#DCDCDC',
  'hljs-comment': '#57A64A',
  'hljs-quote': '#57A64A',
  'hljs-doctag': '#608B4E',
  'hljs-meta': '#9B9B9B',
  'hljs-tag': '#9B9B9B',
  'hljs-variable': '#BD63C5',
  'hljs-template-variable': '#BD63C5',
  'hljs-attr': '#9CDCFE',
  'hljs-attribute': '#9CDCFE',
  'hljs-section': '#FFD700',
  'hljs-bullet': '#D7BA7D',
  'hljs-selector-tag': '#D7BA7D',
  'hljs-selector-id': '#D7BA7D',
  'hljs-selector-class': '#D7BA7D',
  'hljs-selector-attr': '#D7BA7D',
  'hljs-selector-pseudo': '#D7BA7D',
};

const ITALIC = new Set(['hljs-comment', 'hljs-quote', 'hljs-emphasis']);

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function styleFor(classes: string[]): { color: string; fontStyle?: 'italic' } {
  let color = CODE;
  let italic = false;
  for (const name of classes) {
    const next = COLORS[name];
    if (next) color = next;
    if (ITALIC.has(name)) italic = true;
  }
  return italic ? { color, fontStyle: 'italic' } : { color };
}

/** Turn highlight.js HTML into nested Text nodes. Unknown languages stay plain. */
export function highlightCode(code: string, language: string, keyPrefix: string): ReactNode {
  const html = highlightHtml(code, language);
  if (html == null) return code;
  const pieces: ReactNode[] = [];
  const stack: string[][] = [[]];
  const re = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(html))) {
    if (match[1] != null) {
      stack.push(match[1].split(/\s+/).filter(Boolean));
      continue;
    }
    if (match[0] === '</span>') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const raw = match[2];
    if (!raw) continue;
    const classes = stack.flat();
    pieces.push(
      createElement(
        Text,
        { key: `${keyPrefix}-${index}`, style: styleFor(classes) },
        decodeEntities(raw),
      ),
    );
    index += 1;
  }
  return pieces.length > 0 ? pieces : code;
}
