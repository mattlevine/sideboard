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

/** Keep in sync with core `diff/diff.ts` IMAGE_EXTENSIONS. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

function fileExtension(filePath: string): string {
  const base = filePath.split('/').pop()?.toLowerCase() || '';
  return base.includes('.') ? base.split('.').pop() || '' : '';
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(filePath));
}

/** MIME type for image data URLs (e.g. `image/png`). */
export function imageMimeType(filePath: string): string {
  return IMAGE_MIME_BY_EXT[fileExtension(filePath)] || 'image/png';
}

/** Files that support a rendered Preview alongside source (or image-only preview). */
export type DocumentPreviewKind = 'markdown' | 'html' | 'image';

export function documentPreviewKind(filePath: string): DocumentPreviewKind | null {
  if (isImagePath(filePath)) return 'image';
  const lang = detectLanguage(filePath);
  if (lang === 'markdown') return 'markdown';
  if (lang === 'html') return 'html';
  return null;
}
