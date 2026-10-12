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

/** Registered highlight.js name, or '' when the phone has no grammar for it. */
export function resolveLanguage(language: string): string {
  const name = ALIASES[language] ?? language;
  return name && hljs.getLanguage(name) ? name : '';
}

/** Highlight.js language for a worktree path. Unknown extensions stay plain. */
export function languageFromPath(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (!base || base === '.' || base === '..') return '';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base.startsWith('makefile.')) return 'makefile';
  if (base === 'gemfile' || base === 'rakefile') return 'ruby';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = base.slice(dot + 1);
  if (!ext) return '';
  return resolveLanguage(ext);
}

/** Highlighted HTML, or null when the language is unknown or highlighting fails. */
export function highlightHtml(code: string, language: string): string | null {
  const name = resolveLanguage(language);
  if (!name) return null;
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
