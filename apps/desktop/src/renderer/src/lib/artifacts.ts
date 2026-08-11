import type { MessagePart } from '@sideboard-ai/core';

export type ArtifactKind = 'html' | 'markdown' | 'svg' | 'react' | 'code';

export interface ChatArtifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  /** Original fence language when kind is code (or finer html/svg). */
  language: string;
  content: string;
  source: 'fence' | 'tool';
}

const FENCE_RE = /```([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;

const HTML_LANGS = new Set(['html', 'htm', 'xhtml']);
const SVG_LANGS = new Set(['svg']);
const MD_LANGS = new Set(['markdown', 'md', 'mdx']);
/** Skip languages that already have in-chat rendering or aren't pane-worthy. */
const SKIP_LANGS = new Set([
  'mermaid',
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  'text',
  'plain',
  'diff',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env',
  'csv',
]);

const MIN_FENCE_CHARS = 40;
const MIN_MD_CHARS = 120;

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function parseMaybeJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function looksLikeHtmlDocument(content: string): boolean {
  const t = content.trim().slice(0, 200).toLowerCase();
  return (
    t.startsWith('<!doctype') ||
    t.startsWith('<html') ||
    t.startsWith('<svg') ||
    (t.startsWith('<') && /<\/(html|body|svg|div|section|main)>/i.test(content))
  );
}

function titleFromContent(kind: ArtifactKind, content: string, fallback: string): string {
  if (kind === 'html' || kind === 'svg') {
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(content)?.[1]?.trim();
    if (title) return title;
  }
  if (kind === 'markdown') {
    const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    if (heading) return heading;
  }
  if (kind === 'react') {
    const name = /export\s+default\s+(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(content)?.[1];
    if (name) return name;
  }
  return fallback;
}

function kindForLanguage(language: string, content: string): ArtifactKind | null {
  const lang = language.toLowerCase();
  if (!lang) {
    if (looksLikeHtmlDocument(content)) {
      return content.trim().toLowerCase().startsWith('<svg') ? 'svg' : 'html';
    }
    return null;
  }
  if (HTML_LANGS.has(lang)) return 'html';
  if (SVG_LANGS.has(lang)) return 'svg';
  if (MD_LANGS.has(lang)) return 'markdown';
  if (SKIP_LANGS.has(lang)) return null;
  // React / JSX often shipped as artifact-style previews in Claude — render live.
  if (lang === 'jsx' || lang === 'tsx' || lang === 'react') return 'react';
  // Only promote substantial non-trivial code fences when they look intentional.
  if (content.trim().length >= 200) return 'code';
  return null;
}

function languageLabel(kind: ArtifactKind, language: string): string {
  if (language) return language.toLowerCase();
  if (kind === 'html') return 'html';
  if (kind === 'svg') return 'svg';
  if (kind === 'markdown') return 'markdown';
  return 'code';
}

/** Extract fenced artifacts from markdown agent text. */
export function extractFenceArtifacts(
  text: string,
  idPrefix = 'fence',
): ChatArtifact[] {
  if (!text || !text.includes('```')) return [];
  const out: ChatArtifact[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    const language = (match[1] ?? '').trim();
    const content = (match[2] ?? '').replace(/\n$/, '');
    if (content.trim().length < MIN_FENCE_CHARS) {
      index += 1;
      continue;
    }
    const kind = kindForLanguage(language, content);
    if (!kind) {
      index += 1;
      continue;
    }
    if (kind === 'markdown' && content.trim().length < MIN_MD_CHARS) {
      index += 1;
      continue;
    }
    const lang = languageLabel(kind, language);
    const title = titleFromContent(
      kind,
      content,
      kind === 'html'
        ? 'HTML artifact'
        : kind === 'svg'
          ? 'SVG artifact'
          : kind === 'markdown'
            ? 'Document'
            : kind === 'react'
              ? 'React artifact'
              : `${lang} artifact`,
    );
    out.push({
      id: `${idPrefix}-${index}`,
      title,
      kind,
      language: lang,
      content,
      source: 'fence',
    });
    index += 1;
  }
  return out;
}

function contentFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  const rec = asRecord(value);
  if (!rec) return undefined;
  return (
    str(rec.html) ??
    str(rec.markup) ??
    str(rec.code) ??
    str(rec.text) ??
    str(rec.source) ??
    str(rec.content) ??
    (typeof rec.content === 'object' ? contentFromUnknown(rec.content) : undefined)
  );
}

function kindFromArtifactType(type: string | undefined, content: string): ArtifactKind {
  const t = (type ?? '').toLowerCase();
  if (t.includes('svg')) return 'svg';
  if (t.includes('markdown') || t === 'md') return 'markdown';
  if (t.includes('react') || t.includes('jsx') || t.includes('tsx')) return 'react';
  if (t.includes('html') || t.includes('page')) return 'html';
  if (looksLikeHtmlDocument(content)) {
    return content.trim().toLowerCase().startsWith('<svg') ? 'svg' : 'html';
  }
  if (content.trim().startsWith('#')) return 'markdown';
  return 'html';
}

/** Cursor MCP nests tool args under `{ toolName, providerIdentifier, args }`. */
export function flattenToolInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const nested = asRecord(input.args);
  if (
    nested &&
    (typeof input.toolName === 'string' || typeof input.providerIdentifier === 'string')
  ) {
    return nested;
  }
  return input;
}

/** Unwrap Cursor MCP `{ value: { content: [{ text: { text } }] } }` result envelopes. */
export function unwrapToolResultPayload(result: unknown): unknown {
  const parsed = parseMaybeJson(result);
  const rec = asRecord(parsed);
  if (!rec) return parsed;

  const collectTexts = (items: unknown[]): string[] => {
    const texts: string[] = [];
    for (const item of items) {
      const row = asRecord(item);
      if (!row) continue;
      if (typeof row.text === 'string') {
        texts.push(row.text);
        continue;
      }
      const nested = asRecord(row.text);
      if (typeof nested?.text === 'string') texts.push(nested.text);
    }
    return texts;
  };

  const value = asRecord(rec.value);
  if (value && Array.isArray(value.content)) {
    const texts = collectTexts(value.content);
    if (texts.length === 1) return parseMaybeJson(texts[0]);
    if (texts.length > 1) return texts.map((t) => parseMaybeJson(t));
  }
  if (Array.isArray(rec.content) && rec.content.every((c) => asRecord(c)?.text != null)) {
    const texts = collectTexts(rec.content);
    if (texts.length === 1) return parseMaybeJson(texts[0]);
    if (texts.length > 1) return texts.map((t) => parseMaybeJson(t));
  }
  return parsed;
}

export function toolShortName(name: string, input?: Record<string, unknown>): string {
  const fromName = name.replace(/^mcp__[^_]+__/, '').replace(/^mcp__/, '');
  if (fromName && fromName !== 'mcp' && fromName !== 'tool') return fromName;
  if (typeof input?.toolName === 'string' && input.toolName.trim()) return input.toolName.trim();
  return fromName;
}

function matchesPresentTool(shortName: string, suffix: string): boolean {
  return new RegExp(`${suffix}$`, 'i').test(shortName);
}

/** Extract artifacts from present_artifact / Brightsy create|update_artifact tool parts. */
export function extractToolArtifacts(parts: MessagePart[] | undefined): ChatArtifact[] {
  if (!parts?.length) return [];
  const out: ChatArtifact[] = [];
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const rawInput = asRecord(part.input);
    const shortName = toolShortName(part.name, rawInput);
    if (
      !/^(create|update)_artifact$/i.test(shortName) &&
      !matchesPresentTool(shortName, 'present_artifact')
    ) {
      continue;
    }

    const input = flattenToolInput(rawInput);
    const result = unwrapToolResultPayload(part.result);
    const resultRec = asRecord(result);
    const wrapped =
      asRecord(resultRec?.data) ??
      asRecord(resultRec?.artifact) ??
      asRecord(resultRec?.plan) ??
      resultRec;

    const content =
      contentFromUnknown(wrapped?.content) ??
      contentFromUnknown(input?.content) ??
      contentFromUnknown(wrapped) ??
      contentFromUnknown(input);

    if (!content || content.trim().length < MIN_FENCE_CHARS) continue;

    const artifactId =
      str(wrapped?.artifact_id) ??
      str(input?.artifact_id) ??
      str(wrapped?.id) ??
      part.id;
    const type = str(wrapped?.type) ?? str(input?.type);
    const kind = kindFromArtifactType(type, content);
    const title =
      str(wrapped?.title) ??
      str(input?.title) ??
      titleFromContent(kind, content, 'Artifact');

    out.push({
      id: `tool-${artifactId}`,
      title,
      kind,
      language: languageLabel(kind, type ?? ''),
      content,
      source: 'tool',
    });
  }
  return out;
}

/** Collect artifacts from a turn's text + structured parts (tools win on duplicate titles). */
export function extractArtifacts(
  text: string,
  parts?: MessagePart[],
  idPrefix = 'fence',
): ChatArtifact[] {
  const fromTools = extractToolArtifacts(parts);
  const textSource =
    parts
      ?.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n') || text;
  const fromFences = extractFenceArtifacts(textSource, idPrefix);
  // Prefer tool artifacts; append fence ones that aren't already covered by tool content.
  const toolContents = new Set(fromTools.map((a) => a.content.trim()));
  const fences = fromFences.filter((a) => !toolContents.has(a.content.trim()));
  return [...fromTools, ...fences];
}

/**
 * Wrap a React component module (JSX/TSX, `export default`) into a standalone
 * HTML page that loads React/ReactDOM/Babel from a CDN and renders it client-side.
 * Fed through the same sandboxed iframe pipeline as `html` artifacts.
 */
export function wrapReactArtifactHtml(source: string): string {
  const safeSource = JSON.stringify(source).replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body,#root{height:100%;margin:0;}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.artifact-react-error{color:#b91c1c;padding:16px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}</style>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var source = ${safeSource};
  function showError(err) {
    document.getElementById('root').innerHTML =
      '<div class="artifact-react-error"></div>';
    document.querySelector('.artifact-react-error').textContent =
      (err && err.stack) || String(err);
  }
  try {
    var transformed = Babel.transform(source, {
      presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
      plugins: ['transform-modules-commonjs'],
      filename: 'artifact.tsx',
    }).code;
    var moduleObj = { exports: {} };
    function requireShim(name) {
      if (name === 'react') return window.React;
      if (name === 'react-dom' || name === 'react-dom/client') return window.ReactDOM;
      throw new Error('Module not available in Sideboard React preview: ' + name);
    }
    var run = new Function('module', 'exports', 'require', 'React', 'ReactDOM', transformed);
    run(moduleObj, moduleObj.exports, requireShim, window.React, window.ReactDOM);
    var Component = moduleObj.exports.default || moduleObj.exports.App || moduleObj.exports;
    if (typeof Component !== 'function') {
      throw new Error(
        'No default export component found. Export a React component, e.g. export default function App() { ... }',
      );
    }
    var root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(Component));
  } catch (err) {
    showError(err);
  }
})();
</script>
</body>
</html>`;
}

/** Pick the newest artifact worth showing in the side column. */
export function latestArtifact(
  text: string,
  parts?: MessagePart[],
  idPrefix = 'fence',
): ChatArtifact | null {
  const list = extractArtifacts(text, parts, idPrefix);
  return list.length ? list[list.length - 1]! : null;
}
