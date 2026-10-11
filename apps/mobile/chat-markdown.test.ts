import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(new URL('./package.json', import.meta.url));
const MarkdownIt = createRequire(require.resolve('react-native-markdown-display'))('markdown-it');

/** Same options as chatMarkdown in chat-markdown.ts. */
const markdown = MarkdownIt({ typographer: true, linkify: true });

function hrefs(source: string): string[] {
  const found: string[] = [];
  const walk = (tokens: Array<{ type: string; attrGet?: (name: string) => string | null; children?: unknown[] }>) => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const href = token.attrGet?.('href');
        if (href) found.push(href);
      }
      if (token.children) walk(token.children as typeof tokens);
    }
  };
  walk(markdown.parse(source, {}));
  return found;
}

describe('phone chat urls', () => {
  it('uses the linkify parser on the bubble', () => {
    const parser = readFileSync(new URL('./chat-markdown.ts', import.meta.url), 'utf8');
    const bubble = readFileSync(new URL('./markdown.tsx', import.meta.url), 'utf8');
    expect(parser).toContain('linkify: true');
    expect(bubble).toContain('markdownit={chatMarkdown}');
  });

  it('turns a bare https url into a link and leaves fenced code alone', () => {
    expect(hrefs('see https://github.com/mattlevine/sideboard/pull/279 now')).toEqual([
      'https://github.com/mattlevine/sideboard/pull/279',
    ]);
    expect(hrefs('```\nhttps://example.com\n```')).toEqual([]);
    expect(hrefs('already [docs](https://example.com/docs)')).toEqual(['https://example.com/docs']);
    expect(hrefs('`https://example.com` stays')).toEqual([]);
  });

  it('keeps a sideboard chat link tappable', () => {
    expect(hrefs('[abc](sideboard://chat/abc-123)')).toEqual(['sideboard://chat/abc-123']);
  });
});
