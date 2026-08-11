import { describe, expect, it } from 'vitest';
import { normalizeMarkdownTables } from './normalize-markdown-tables';

describe('normalizeMarkdownTables', () => {
  it('expands a short delimiter to match a 3-column header', () => {
    const input = [
      '| PR #10 fix | In `main`? | Manual trigger |',
      '|---|',
      '| History filter | **Yes** | N/A |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(
      [
        '| PR #10 fix | In `main`? | Manual trigger |',
        '| --- | --- | --- |',
        '| History filter | **Yes** | N/A |',
      ].join('\n'),
    );
  });

  it('leaves a correct delimiter alone', () => {
    const input = [
      '| A | B | C |',
      '| --- | --- | --- |',
      '| 1 | 2 | 3 |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('ignores non-table pipe text', () => {
    const input = 'use `|---|` in docs';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });
});
