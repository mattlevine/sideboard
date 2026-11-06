import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { preparePhoneMarkdown } from '../../../../apps/mobile/prepare-markdown.ts';
import { tableColumnWidths } from '../../../../apps/mobile/markdown-table.ts';
import { taskListPlugin } from '../../../../apps/mobile/task-lists.ts';

const require = createRequire(new URL('../../../../apps/mobile/package.json', import.meta.url));
const MarkdownIt = createRequire(require.resolve('react-native-markdown-display'))('markdown-it');

type Token = {
  type: string;
  content: string;
  nesting: number;
  children?: Token[] | null;
  attrGet?: (name: string) => string | null;
};

/** Same parser options the phone bubble uses. */
function parse(source: string): Token[] {
  const markdown = MarkdownIt({ typographer: true, linkify: true }).use(taskListPlugin);
  return markdown.parse(preparePhoneMarkdown(source), {}) as Token[];
}

function hrefs(source: string): string[] {
  const found: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const href = token.attrGet?.('href');
        if (href) found.push(href);
      }
      if (token.children) walk(token.children);
    }
  };
  walk(parse(source));
  return found;
}

function tasks(source: string): { task: string | null; text: string }[] {
  const tokens = parse(source);
  const out: { task: string | null; text: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.type !== 'list_item_open') continue;
    const inline = tokens.slice(i + 1).find((entry) => entry.type === 'inline');
    const text = (inline?.children ?? [])
      .filter((child) => child.type === 'text')
      .map((child) => child.content)
      .join('');
    out.push({ task: token.attrGet?.('task') ?? null, text });
  }
  return out;
}

describe('phone markdown', () => {
  it('parses the marks desktop chat renders', () => {
    const tokens = parse(
      [
        '# Title',
        '',
        '**bold** *italic* ~~gone~~',
        '',
        '- item',
        '',
        '1. one',
        '',
        '> quoted',
        '',
        '---',
        '',
        '![shot](https://example.com/a.png)',
        '',
        '`code` and https://example.com/docs',
        '',
        '```ts',
        'https://example.com/hidden',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
    );
    const blocks = tokens.filter((token) => token.nesting === 1).map((token) => token.type);
    expect(blocks).toEqual([
      'heading_open',
      'paragraph_open',
      'bullet_list_open',
      'list_item_open',
      'paragraph_open',
      'ordered_list_open',
      'list_item_open',
      'paragraph_open',
      'blockquote_open',
      'paragraph_open',
      'paragraph_open',
      'paragraph_open',
      'table_open',
      'thead_open',
      'tr_open',
      'th_open',
      'th_open',
      'tbody_open',
      'tr_open',
      'td_open',
      'td_open',
    ]);
    expect(tokens.some((token) => token.type === 'hr')).toBe(true);
    expect(tokens.some((token) => token.children?.some((child) => child.type === 'image'))).toBe(true);
    expect(tokens.some((token) => token.type === 'fence' && token.content.includes('hidden'))).toBe(true);
    const inline = tokens.find((token) => token.children?.some((child) => child.type === 's_open'));
    expect(inline?.children?.some((child) => child.type === 'strong_open')).toBe(true);
    expect(inline?.children?.some((child) => child.type === 'em_open')).toBe(true);
    expect(hrefs('see https://example.com/docs')).toEqual(['https://example.com/docs']);
    expect(hrefs('```\nhttps://example.com\n```')).toEqual([]);
    expect(hrefs('`https://example.com` stays')).toEqual([]);
  });

  it('draws task lists as checkboxes and leaves the label', () => {
    expect(tasks('- [ ] todo\n- [x] done\n- plain')).toEqual([
      { task: 'open', text: 'todo' },
      { task: 'checked', text: 'done' },
      { task: null, text: 'plain' },
    ]);
    expect(tasks('```\n- [ ] not a task\n```')).toEqual([]);
  });

  it('repairs a short table delimiter the way the desktop does', () => {
    const tokens = parse('| Name | Status |\n|---|\n| History | Yes |');
    expect(tokens.some((token) => token.type === 'table_open')).toBe(true);
    expect(tokens.filter((token) => token.type === 'th_open')).toHaveLength(2);
  });

  it('turns Slack mrkdwn into markdown and leaves fenced text alone', () => {
    const prepared = preparePhoneMarkdown('See <https://example.com/a|Docs> please\n• one\n• two');
    expect(prepared).toContain('[Docs](https://example.com/a)');
    expect(prepared).toContain('- one');
    expect(prepared).toContain('- two');
    expect(preparePhoneMarkdown('```\n<https://example.com|docs>\n• stay\n```')).toBe(
      '```\n<https://example.com|docs>\n• stay\n```',
    );
  });

  it('linkifies bare sideboard chats, files, and artifacts', () => {
    expect(preparePhoneMarkdown('see sideboard://chat/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://chat/abcdef12-3456)',
    );
    expect(preparePhoneMarkdown('see sideboard://thread/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://chat/abcdef12-3456)',
    );
    expect(preparePhoneMarkdown('[Arsenal](sideboard://chat/abc-123)')).toBe(
      '[Arsenal](sideboard://chat/abc-123)',
    );
    expect(preparePhoneMarkdown('open sideboard://file/apps/desktop/src/App.tsx#L12-L40')).toBe(
      'open [App.tsx:12-40](sideboard://file/apps/desktop/src/App.tsx#L12-L40)',
    );
    expect(preparePhoneMarkdown('see sideboard://artifact/Dashboard')).toBe(
      'see [Dashboard](sideboard://artifact/Dashboard)',
    );
    expect(hrefs('see sideboard://chat/abcdef12-3456')).toEqual(['sideboard://chat/abcdef12-3456']);
  });

  it('gives every row in a column the same width', () => {
    const long = 'History filter keeps the long label';
    expect(
      tableColumnWidths({
        children: [
          {
            children: [
              {
                children: [{ children: [{ content: 'Name' }] }, { children: [{ content: 'Status' }] }],
              },
            ],
          },
          {
            children: [
              {
                children: [{ children: [{ content: long }] }, { children: [{ content: 'Yes' }] }],
              },
            ],
          },
        ],
      }),
    ).toEqual([280, 68]);
  });

  it('does not let the leaf text style flatten headings', () => {
    const src = readFileSync(new URL('../../../../apps/mobile/markdown-styles.ts', import.meta.url), 'utf8');
    const shared = src.slice(src.indexOf('const shared = {'), src.indexOf('export const agentMarkdown'));
    const textStyle = shared.match(/\n  text: \{([^}]*)\}/);
    expect(textStyle).not.toBeNull();
    expect(textStyle?.[1] ?? '').not.toMatch(/fontSize|fontWeight|lineHeight|letterSpacing|\bcolor\b/);
    const ask = src.slice(src.indexOf('export const askMarkdown'));
    expect(ask).toMatch(/fontWeight: '500'/);
    expect(ask).not.toMatch(/text:\s*\{[^}]*fontWeight/);
    const bubble = readFileSync(new URL('../../../../apps/mobile/markdown.tsx', import.meta.url), 'utf8');
    expect(bubble).toContain('preparePhoneMarkdown');
    expect(bubble).toContain('markdownBlockRules');
  });
});
