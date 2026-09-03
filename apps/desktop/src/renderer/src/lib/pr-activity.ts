import type { PrDetails, ThreadAttachment } from '@sideboard-ai/core';

export type PrActivityKind = 'comment' | 'review';

export interface PrActivityItem {
  id: string;
  kind: PrActivityKind;
  author: string;
  body: string;
  at: string;
  reviewState?: string;
}

export function prTabTitle(input: {
  prUrl?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  number?: number | string | null;
}): string {
  if (input.number != null && String(input.number).trim()) {
    return `PR #${String(input.number).replace(/^#/, '')}`;
  }
  const fromUrl = githubPullNumber(input.prUrl);
  if (fromUrl) return `PR #${fromUrl}`;
  if (input.sourceType === 'pr') {
    const n = (input.sourceRef ?? '').replace(/^#/, '');
    if (/^\d+$/.test(n)) return `PR #${n}`;
  }
  return 'PR';
}

export function githubPullNumber(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/pull\/(\d+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function reviewStateLabel(state: string | null | undefined): string {
  switch ((state ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'Approved';
    case 'CHANGES_REQUESTED':
      return 'Requested changes';
    case 'COMMENTED':
      return 'Commented';
    case 'DISMISSED':
      return 'Dismissed';
    case 'PENDING':
      return 'Pending';
    default:
      return state?.trim() ? state.replace(/_/g, ' ') : 'Review';
  }
}

export function relativePrTime(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || !iso) return '';
  const mins = Math.floor(Math.max(0, ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function prActivityItems(details: Pick<PrDetails, 'comments' | 'reviews'>): PrActivityItem[] {
  const comments = (details.comments ?? []).map((c, i) => ({
    id: `comment:${c.createdAt}:${c.author.login}:${i}`,
    kind: 'comment' as const,
    author: c.author.login,
    body: c.body ?? '',
    at: c.createdAt,
  }));
  const reviews = (details.reviews ?? []).map((r, i) => ({
    id: `review:${r.submittedAt ?? 'none'}:${r.author.login}:${i}`,
    kind: 'review' as const,
    author: r.author.login,
    body: r.body ?? '',
    at: r.submittedAt ?? '',
    reviewState: r.state,
  }));
  return [...comments, ...reviews].sort((a, b) => {
    const ta = Date.parse(a.at) || 0;
    const tb = Date.parse(b.at) || 0;
    return ta - tb;
  });
}

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

const ALLOWED_HTML_TAGS = new Set([
  'a',
  'img',
  'picture',
  'source',
  'p',
  'br',
  'div',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'hr',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  source: new Set(['srcset', 'media', 'type']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

function htmlAttr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return m?.[2] ?? m?.[3] ?? m?.[4] ?? null;
}

function firstSrcsetUrl(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  const first = srcset.trim().split(',')[0]?.trim().split(/\s+/)[0] ?? '';
  return first || null;
}

/**
 * Vercel PR comments still point at request-review-{dark,light}.svg on
 * agents-vade-review.vercel.sh; those paths 404. The un-suffixed SVG works.
 */
export function rewriteDeadBadgeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (
      u.hostname === 'agents-vade-review.vercel.sh' &&
      /\/request-review-(dark|light)\.svg$/i.test(u.pathname)
    ) {
      u.pathname = '/request-review.svg';
      return u.toString();
    }
  } catch {
    return url;
  }
  return url;
}

function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = firstSrcsetUrl(raw) ?? raw.trim();
  const url = rewriteDeadBadgeUrl(first);
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return null;
}

/** GitHub bot comments indent HTML, which markdown treats as a fenced code block. */
export function unwrapIndentedHtml(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (/^ {4,}</.test(line)) {
      while (i < lines.length) {
        const cur = lines[i]!;
        if (cur === '') {
          out.push('');
          i += 1;
          continue;
        }
        if (!/^ {4}/.test(cur)) break;
        out.push(cur.replace(/^ {4}/, ''));
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
}

function pickPictureSrc(pictureHtml: string): { src: string; alt: string } {
  const dark = pictureHtml.match(
    /prefers-color-scheme:\s*dark[\s\S]{0,120}?srcset=["']([^"']+)/i,
  );
  const img = pictureHtml.match(/<img\b([^>]*)>/i)?.[0] ?? '';
  return {
    src: firstSrcsetUrl(dark?.[1]) ?? htmlAttr(img, 'src') ?? '',
    alt: htmlAttr(img, 'alt') ?? '',
  };
}

function mdImage(src: string, alt: string, href?: string | null): string {
  const safeSrc = safeUrl(src);
  if (!safeSrc) return alt || '';
  const img = `![${alt}](${safeSrc})`;
  const safeHref = safeUrl(href ?? null);
  return safeHref ? `[${img}](${safeHref})` : img;
}

/** Turn GitHub/Vercel HTML fragments into markdown so the local PR page can render them. */
export function htmlFragmentsToMarkdown(text: string): string {
  let s = unwrapIndentedHtml(text);
  s = s.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, attrs: string, inner: string) => {
      const href = htmlAttr(`<a ${attrs}>`, 'href');
      if (/<picture/i.test(inner)) {
        const pic = pickPictureSrc(inner);
        return mdImage(pic.src, pic.alt, href);
      }
      if (/<img\b/i.test(inner)) {
        const img = inner.match(/<img\b([^>]*)>/i)?.[0] ?? '';
        return mdImage(htmlAttr(img, 'src') ?? '', htmlAttr(img, 'alt') ?? '', href);
      }
      const label = inner.replace(/<[^>]+>/g, '').trim() || href || '';
      const safeHref = safeUrl(href);
      return safeHref ? `[${label}](${safeHref})` : label;
    },
  );
  s = s.replace(/<picture\b[\s\S]*?<\/picture>/gi, (picture) => {
    const pic = pickPictureSrc(picture);
    return mdImage(pic.src, pic.alt);
  });
  s = s.replace(/<img\b([^>]*)>/gi, (img) =>
    mdImage(htmlAttr(img, 'src') ?? '', htmlAttr(img, 'alt') ?? ''),
  );
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<p\b[^>]*>/gi, '');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function sanitizePrHtml(html: string): string {
  let s = unwrapIndentedHtml(html);
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    const closing = full.startsWith('</');
    if (!ALLOWED_HTML_TAGS.has(tag)) return '';
    if (closing || tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'source') {
      if (closing) return `</${tag}>`;
    }
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) return `<${tag}>`;
    const attrs: string[] = [];
    const re = /([a-zA-Z:_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawAttrs))) {
      const name = m[1]!.toLowerCase();
      if (!allowed.has(name)) continue;
      let value = m[3] ?? m[4] ?? m[5] ?? '';
      if (name === 'href' || name === 'src' || name === 'srcset') {
        const first = value.split(/\s+/)[0] ?? '';
        if (!safeUrl(first) && !/^https?:\/\//i.test(value)) continue;
        if (name === 'srcset') {
          value = value
            .split(',')
            .map((part) => {
              const trimmed = part.trim();
              const [candidate, ...rest] = trimmed.split(/\s+/);
              const safe = safeUrl(candidate);
              if (!safe) return trimmed;
              return [safe, ...rest].join(' ');
            })
            .join(', ');
        } else if (name === 'href' || name === 'src') {
          const safe = safeUrl(value);
          if (!safe) continue;
          value = safe;
        }
      }
      attrs.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
    }
    if (tag === 'a') {
      attrs.push('target="_blank"', 'rel="noreferrer noopener"');
    }
    const voidTag = tag === 'img' || tag === 'br' || tag === 'hr' || tag === 'source';
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${voidTag ? ' />' : '>'}`;
  });
  return s;
}

export type PreparedPrComment =
  | { mode: 'markdown'; text: string }
  | { mode: 'html'; html: string };

export function preparePrCommentBody(text: string): PreparedPrComment {
  const unwrapped = unwrapIndentedHtml(text);
  if (/<table\b/i.test(unwrapped)) {
    return { mode: 'html', html: sanitizePrHtml(unwrapped) };
  }
  const converted = htmlFragmentsToMarkdown(unwrapped);
  if (HTML_TAG.test(converted)) {
    return { mode: 'html', html: sanitizePrHtml(unwrapped) };
  }
  return { mode: 'markdown', text: converted };
}

export function prDetailsAttachment(details: PrDetails): ThreadAttachment {
  const items = prActivityItems(details);
  const activity = items
    .map((item) => {
      const label =
        item.kind === 'review'
          ? reviewStateLabel(item.reviewState)
          : 'Comment';
      const when = item.at ? ` · ${item.at}` : '';
      const body = item.body.trim() ? `\n\n${item.body.trim()}` : '';
      return `### @${item.author} — ${label}${when}${body}`;
    })
    .join('\n\n');
  const content = [
    `#${details.number} ${details.title}`.trim(),
    details.url ? `URL: ${details.url}` : null,
    details.body.trim() ? `## Description\n\n${details.body.trim()}` : null,
    activity ? `## Activity\n\n${activity}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    id: crypto.randomUUID(),
    name: `#${details.number}`,
    kind: 'issue',
    content,
  };
}
