import { createElement, type ReactNode } from 'react';
import { Text } from 'react-native';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

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

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('less', less);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('php', php);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  cs: 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  ps1: 'powershell',
  docker: 'dockerfile',
  golang: 'go',
  text: 'plaintext',
  txt: 'plaintext',
};

export function fenceLanguage(info: string | undefined): string {
  return (info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

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
  const name = ALIASES[language] ?? language;
  if (!name || !hljs.getLanguage(name)) return code;
  let html = '';
  try {
    html = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return code;
  }
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
