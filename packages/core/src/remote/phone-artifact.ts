import type { MessagePart } from '../types/thread.js';

/** Phone tap: open this document in the Mac’s side column. */
export type PhoneOpenArtifact = {
  op: 'open-artifact';
  chatId: string;
  title: string;
  hint?: string;
};

export type PhoneOpenArtifactRequest = {
  threadId: string;
  title: string;
  hint?: string;
};

const FENCE_RE = /```([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
const DOC_LANGS = new Set(['html', 'htm', 'xhtml', 'svg', 'markdown', 'md', 'mdx', 'jsx', 'tsx', 'react']);
const MIN_FENCE_CHARS = 40;
const MIN_MD_CHARS = 120;

function oneLine(value: string, max: number): string {
  return value.replace(/[`\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizedBody(content: string): string {
  return content.trim().replace(/\s+/g, ' ');
}

/** Full-body id. A leading slice collides: HTML and React documents share their opening boilerplate. */
export function artifactHint(content: string): string {
  const body = normalizedBody(content);
  if (!body) return '';
  return fnv1a32(body).toString(36);
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function looksLikeHtml(content: string): boolean {
  const head = content.trim().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<svg');
}

function kindFor(language: string, content: string): 'html' | 'svg' | 'markdown' | 'react' | null {
  const lang = language.toLowerCase();
  if (!lang) {
    if (!looksLikeHtml(content) || content.trim().length < MIN_FENCE_CHARS) return null;
    return content.trim().toLowerCase().startsWith('<svg') ? 'svg' : 'html';
  }
  if (!DOC_LANGS.has(lang)) return null;
  const min = lang === 'markdown' || lang === 'md' || lang === 'mdx' ? MIN_MD_CHARS : MIN_FENCE_CHARS;
  if (content.trim().length < min) return null;
  if (lang === 'svg') return 'svg';
  if (lang === 'markdown' || lang === 'md' || lang === 'mdx') return 'markdown';
  if (lang === 'jsx' || lang === 'tsx' || lang === 'react') return 'react';
  return 'html';
}

function titleFor(kind: 'html' | 'svg' | 'markdown' | 'react', content: string): string {
  if (kind === 'html' || kind === 'svg') {
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(content)?.[1]?.trim();
    if (title) return oneLine(title, 80);
  }
  if (kind === 'markdown') {
    const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    if (heading) return oneLine(heading, 80);
  }
  if (kind === 'react') {
    const name = /export\s+default\s+(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(content)?.[1];
    if (name) return name;
  }
  if (kind === 'svg') return 'SVG artifact';
  if (kind === 'markdown') return 'Document';
  if (kind === 'react') return 'React artifact';
  return 'HTML artifact';
}

function marker(title: string, hint: string): string {
  return hint ? `\`\`\`sb-artifact\n${title}\n${hint}\n\`\`\`` : `\`\`\`sb-artifact\n${title}\n\`\`\``;
}

function toolContent(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const direct = input.content;
  if (typeof direct === 'string') return direct;
  const nested = asRecord(direct);
  if (!nested) return '';
  for (const key of ['html', 'markup', 'text', 'source', 'content', 'code']) {
    if (typeof nested[key] === 'string') return nested[key];
  }
  return '';
}

function isArtifactTool(name: string): boolean {
  const short = name.split('__').pop() ?? name;
  return /^(present_artifact|create_artifact|update_artifact)$/i.test(short);
}

/**
 * Replace document fences with a short chip, and append chips for present_artifact
 * tools whose body is not already in the text. Code fences stay in the chat.
 */
export function phoneArtifactText(text: string, parts?: MessagePart[], limit = Number.POSITIVE_INFINITY): string {
  const hints = new Set<string>();
  const body = text.replace(new RegExp(FENCE_RE.source, 'g'), (full, language: string, content: string) => {
    const kind = kindFor(language, content);
    if (!kind) return full;
    const hint = artifactHint(content);
    hints.add(hint);
    return marker(titleFor(kind, content), hint);
  });
  const extras: string[] = [];
  for (const part of parts ?? []) {
    if (part.type !== 'tool' || part.parentId || !isArtifactTool(part.name)) continue;
    const input = asRecord(part.input);
    const content = toolContent(input);
    const hint = artifactHint(content);
    if (hint && hints.has(hint)) continue;
    const kind = kindFor('', content);
    const title = oneLine(str(input?.title), 80) || (kind ? titleFor(kind, content) : 'Artifact');
    if (!str(input?.title) && content.trim().length < MIN_FENCE_CHARS) continue;
    if (hint) hints.add(hint);
    extras.push(marker(title, hint));
  }
  const tail = extras.join('\n\n');
  const room = tail ? Math.max(0, limit - tail.length - 2) : limit;
  const prose = body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body;
  if (!tail) return prose;
  return prose ? `${prose}\n\n${tail}` : tail;
}

export function parseOpenArtifact(value: unknown, chatId: string): PhoneOpenArtifact | 'invalid' {
  const record = asRecord(value);
  if (!record) return 'invalid';
  const title = oneLine(str(record.title), 200);
  if (!title) return 'invalid';
  const hint = oneLine(str(record.hint), 200);
  return { op: 'open-artifact', chatId, title, ...(hint ? { hint } : {}) };
}

function newest<T>(items: T[]): T | null {
  return items.length ? (items[items.length - 1] ?? null) : null;
}

/**
 * Newest matching document. `items` is oldest first.
 * A full-body hint identifies one document. A shared prefix matches only when the title agrees,
 * so a later pane with the same HTML or React boilerplate does not win.
 */
export function pickArtifactMatch<T extends { title: string; content?: string }>(
  items: T[],
  request: { title: string; hint?: string },
): T | null {
  const hint = request.hint?.trim();
  const title = request.title.trim();
  if (hint) {
    const exact = items.filter((item) => item.content && artifactHint(item.content) === hint);
    const exactTitled = title ? exact.filter((item) => item.title === title) : [];
    const exactMatch = newest(exactTitled.length ? exactTitled : exact);
    if (exactMatch) return exactMatch;
    if (title) {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item?.content || item.title !== title) continue;
        if (normalizedBody(item.content).startsWith(hint)) return item;
      }
    }
  }
  if (!title) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.title === title) return items[i] ?? null;
  }
  return null;
}
