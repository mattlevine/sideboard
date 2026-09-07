import { describe, expect, it } from 'vitest';
import {
  CRUSH_BODY_MIN_CHARS,
  CRUSH_COMMENT_MAX_CHARS,
  CRUSH_MIN_CHARS,
  CRUSH_MIN_ITEMS,
  crushMarkdown,
  crushTextItems,
  dedupTextItems,
} from './smart-crush.js';

function comment(body: string, id?: string): { id: string; body: string } {
  return { id: id ?? body.slice(0, 12), body };
}

describe('dedupTextItems', () => {
  it('keeps unique comments and drops exact duplicates', () => {
    const out = dedupTextItems(
      [
        comment('Ship the login fix', 'a'),
        comment('Ship the login fix', 'b'),
        comment('Different note', 'c'),
      ],
      (c) => c.body,
    );
    expect(out.items.map((c) => c.id)).toEqual(['a', 'c']);
    expect(out.dropped).toBe(1);
  });

  it('drops near-duplicates and keeps the longer copy', () => {
    const long =
      'The flaky auth test failed again on CI after the token refresh change and we should pin the mock.';
    const near =
      'The flaky auth test failed again on CI after the token refresh change and we should pin the mock!';
    const out = dedupTextItems([comment(long, 'a'), comment(near, 'b')], (c) => c.body);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe('a');
  });
});

describe('crushTextItems', () => {
  it('passes through small unique threads (do not lose information)', () => {
    const items = [
      comment('Need a repro'),
      comment('See src/auth.ts'),
      comment('I can take this'),
      comment('Landed on feat/auth'),
    ];
    const out = crushTextItems(items, (c) => c.body);
    expect(out.reason).toBe('passthrough');
    expect(out.items).toEqual(items);
    expect(items.length).toBeLessThan(CRUSH_MIN_ITEMS);
  });

  it('never drops an error comment even on a huge thread', () => {
    const filler = 'x'.repeat(800);
    const items = Array.from({ length: 30 }, (_, i) =>
      comment(`${filler} unique discussion ${i}`, `n${i}`),
    );
    items.splice(10, 0, comment('TypeError: Cannot read property of undefined in auth.ts', 'err'));
    const out = crushTextItems(items, (c) => c.body, { maxChars: 4_000 });
    expect(out.truncated).toBe(true);
    expect(out.items.some((c) => c.id === 'err')).toBe(true);
    expect(out.items.reduce((n, c) => n + c.body.length, 0)).toBeLessThan(items.reduce((n, c) => n + c.body.length, 0));
  });

  it('keeps first and last comments when budgeting', () => {
    const filler = 'y'.repeat(600);
    const items = Array.from({ length: 20 }, (_, i) =>
      comment(`${filler} turn ${i}`, `i${i}`),
    );
    const out = crushTextItems(items, (c) => c.body, { maxChars: 5_000 });
    expect(out.truncated).toBe(true);
    expect(out.items[0]?.id).toBe('i0');
    expect(out.items[out.items.length - 1]?.id).toBe('i19');
  });

  it('prefers code-fence comments when filling the importance slice', () => {
    const filler = 'z'.repeat(500);
    const items = Array.from({ length: 12 }, (_, i) =>
      comment(`${filler} prose ${i}`, `p${i}`),
    );
    items[6] = comment(`${filler}\n\`\`\`ts\nexport const x = 1\n\`\`\``, 'code');
    const out = crushTextItems(items, (c) => c.body, { maxChars: 4_500 });
    expect(out.items.some((c) => c.id === 'code')).toBe(true);
  });

  it('only dedups when the unique thread still fits the budget', () => {
    const body = 'Same bot comment '.repeat(20);
    const items = Array.from({ length: 8 }, (_, i) => comment(body, `d${i}`));
    const unique = comment('Human note about the actual fix in panel.ts', 'human');
    const out = crushTextItems([...items, unique], (c) => c.body);
    expect(out.reason).toBe('dedup');
    expect(out.items.some((c) => c.id === 'human')).toBe(true);
    expect(out.dropped).toBe(7);
    expect(out.items.reduce((n, c) => n + c.body.length, 0)).toBeLessThan(CRUSH_COMMENT_MAX_CHARS);
  });
});

describe('crushMarkdown', () => {
  it('passes through a typical ticket body', () => {
    const text = '## Repro\n\nOpen settings and click Git.\n\n## Expected\n\nToken stays warm.';
    expect(text.length).toBeLessThan(CRUSH_BODY_MIN_CHARS);
    const out = crushMarkdown(text);
    expect(out).toEqual({ text, truncated: false, originalChars: text.length });
  });

  it('keeps error blocks when crushing a huge pasted dump', () => {
    const pad = 'lorem ipsum dolor sit amet '.repeat(200);
    const blocks = Array.from({ length: 20 }, (_, i) => `${pad} section ${i}`);
    blocks[8] = 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed';
    const text = blocks.join('\n\n');
    expect(text.length).toBeGreaterThan(CRUSH_BODY_MIN_CHARS);
    const out = crushMarkdown(text);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain('FATAL ERROR');
    expect(out.text).toContain('include=full');
    expect(out.text.length).toBeLessThan(text.length);
  });

  it('returns the original when crush would not shrink', () => {
    const text = 'short';
    expect(crushMarkdown(text).truncated).toBe(false);
  });
});

describe('gates', () => {
  it('exposes Headroom-compatible floors', () => {
    expect(CRUSH_MIN_ITEMS).toBe(5);
    expect(CRUSH_MIN_CHARS).toBe(800);
  });
});
