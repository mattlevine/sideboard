/** Map file path → Monaco language id (Brightsy-style, simplified). */

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
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
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  txt: 'plaintext',
  log: 'plaintext',
  graphql: 'graphql',
  gql: 'graphql',
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  procfile: 'yaml',
  'cargo.toml': 'ini',
  'go.mod': 'go',
  'package.json': 'json',
  'tsconfig.json': 'json',
  'composer.json': 'json',
};

export function detectLanguage(filePath: string): string {
  const base = filePath.split('/').pop()?.toLowerCase() || '';
  if (FILENAME_LANGUAGE_MAP[base]) return FILENAME_LANGUAGE_MAP[base];
  const ext = base.includes('.') ? base.split('.').pop() || '' : '';
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) return EXTENSION_LANGUAGE_MAP[ext];
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  return 'plaintext';
}

/** Files that support a rendered Preview alongside source. */
export type DocumentPreviewKind = 'markdown' | 'html';

export function documentPreviewKind(filePath: string): DocumentPreviewKind | null {
  const lang = detectLanguage(filePath);
  if (lang === 'markdown') return 'markdown';
  if (lang === 'html') return 'html';
  return null;
}
