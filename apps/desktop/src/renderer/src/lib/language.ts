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

/** Fence / tool language names → Monaco language id. */
const LANGUAGE_NAME_MAP: Record<string, string> = {
  ...EXTENSION_LANGUAGE_MAP,
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  ruby: 'ruby',
  rust: 'rust',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  scala: 'scala',
  json: 'json',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'markdown',
  sql: 'sql',
  shell: 'shell',
  bash: 'shell',
  zsh: 'shell',
  powershell: 'powershell',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  ini: 'ini',
  toml: 'ini',
  react: 'typescript',
  node: 'javascript',
};

/** Labels that are not a real language — sniff the source instead. */
const GENERIC_LANGUAGE_LABELS = new Set([
  'code',
  'text',
  'plain',
  'plaintext',
  'source',
  'src',
  'txt',
]);

const MONACO_LANGUAGE_EXT: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  java: 'java',
  csharp: 'cs',
  cpp: 'cpp',
  c: 'c',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  scala: 'scala',
  json: 'json',
  yaml: 'yml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'md',
  sql: 'sql',
  shell: 'sh',
  powershell: 'ps1',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  ini: 'ini',
};

function isGenericLanguageLabel(raw: string): boolean {
  return !raw || GENERIC_LANGUAGE_LABELS.has(raw) || /^\d+$/.test(raw);
}

export function detectLanguage(filePath: string): string {
  const base = filePath.split('/').pop()?.toLowerCase() || '';
  if (FILENAME_LANGUAGE_MAP[base]) return FILENAME_LANGUAGE_MAP[base];
  const ext = base.includes('.') ? base.split('.').pop() || '' : '';
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) return EXTENSION_LANGUAGE_MAP[ext];
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  return 'plaintext';
}

/** Guess a Monaco language id from source when the fence/tool label is missing or generic. */
export function inferLanguageFromContent(content: string): string | null {
  const sample = content.slice(0, 8000);
  const trimmed = sample.trim();
  if (!trimmed) return null;

  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
  if (/^<svg[\s>]/i.test(trimmed)) return 'html';

  if (
    (trimmed.startsWith('{') && trimmed.includes('}')) ||
    (trimmed.startsWith('[') && trimmed.includes(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* not JSON */
    }
  }

  if (
    /\b(interface|implements|enum|namespace|declare|satisfies)\b/.test(sample) ||
    /\bas const\b/.test(sample) ||
    /:\s*(unknown|string|number|boolean|void|undefined|null|never|any|Record|Promise|Readonly)\b/.test(
      sample,
    )
  ) {
    return 'typescript';
  }

  if (/^\s*(async\s+)?def\s+\w+/m.test(sample)) return 'python';

  if (
    /^\s*fn\s+\w+/m.test(sample) &&
    /\b(let\s+mut|impl|pub\s+(fn|struct|enum))\b/.test(sample)
  ) {
    return 'rust';
  }

  if (/^\s*package\s+\w+/m.test(sample) && /^\s*func\s+/m.test(sample)) return 'go';

  if (
    /\b(import|export)\s+/.test(sample) ||
    /\b(async\s+)?function\b/.test(sample) ||
    /\b(const|let|var)\s+\w+\s*=/.test(sample)
  ) {
    return 'javascript';
  }

  return null;
}

/**
 * Map a fence/tool language label (and optional source) to a Monaco language id.
 * Unrecognized labels such as `code` or `69` fall back to content sniffing.
 */
export function resolveCodeLanguage(label: string, content?: string): string {
  const raw = (label || '').trim().toLowerCase();
  if (!isGenericLanguageLabel(raw)) {
    if (LANGUAGE_NAME_MAP[raw]) return LANGUAGE_NAME_MAP[raw];
    if (raw.includes('.') || raw.includes('/')) {
      const fromPath = detectLanguage(raw);
      if (fromPath !== 'plaintext') return fromPath;
    }
  }
  if (content) {
    const inferred = inferLanguageFromContent(content);
    if (inferred) return inferred;
  }
  return 'plaintext';
}

/** Synthetic path so Monaco can also infer language from the extension. */
export function artifactSourcePath(label: string, content?: string): string {
  const language = resolveCodeLanguage(label, content);
  return `artifact.${MONACO_LANGUAGE_EXT[language] ?? 'txt'}`;
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
