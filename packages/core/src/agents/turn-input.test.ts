import { describe, expect, it } from 'vitest';
import {
  buildCachedUserContent,
  buildClaudeStreamJsonUserMessage,
  countCacheControlBlocks,
  dropCachedPrefixOnResume,
  findInvalidCacheControlTtlOrder,
  flattenTurnInput,
  MAX_ANTHROPIC_CACHE_CONTROL_BLOCKS,
  normalizeTurnInput,
} from './turn-input.js';

describe('normalizeTurnInput', () => {
  it('accepts a plain string', () => {
    expect(normalizeTurnInput('hello')).toEqual({ prompt: 'hello' });
  });

  it('trims empty cachedPrefix', () => {
    expect(normalizeTurnInput({ cachedPrefix: '  ', prompt: 'hi' })).toEqual({
      prompt: 'hi',
      cachedPrefix: undefined,
    });
  });
});

describe('dropCachedPrefixOnResume', () => {
  it('omits cachedPrefix when the CLI session is resumed', () => {
    expect(
      dropCachedPrefixOnResume(
        { cachedPrefix: 'worktree playbook', prompt: 'next step' },
        'sess-1',
      ),
    ).toEqual({ prompt: 'next step' });
    expect(
      dropCachedPrefixOnResume(
        { cachedPrefix: 'worktree playbook', prompt: 'first' },
        null,
      ).cachedPrefix,
    ).toBe('worktree playbook');
  });
});

describe('flattenTurnInput', () => {
  it('keeps stable prefix before the current request', () => {
    const flat = flattenTurnInput({
      cachedPrefix: '## Instructions\nBe careful',
      prompt: 'fix the bug',
    });
    expect(flat.startsWith('## Instructions')).toBe(true);
    expect(flat).toContain('Current request:\nfix the bug');
    expect(flat.indexOf('Instructions')).toBeLessThan(flat.indexOf('fix the bug'));
  });
});

describe('buildCachedUserContent', () => {
  it('flattens stable prefix and prompt into one block without cache_control', () => {
    const content = buildCachedUserContent({
      cachedPrefix: 'seed context',
      prompt: 'do the thing',
    });
    expect(content).toHaveLength(1);
    expect(content[0]!.text).toContain('seed context');
    expect(content[0]!.text).toContain('do the thing');
    expect(countCacheControlBlocks(content)).toBe(0);
  });

  it('returns a single block when there is no prefix', () => {
    expect(buildCachedUserContent('only prompt')).toEqual([
      { type: 'text', text: 'only prompt' },
    ]);
  });
});

describe('buildClaudeStreamJsonUserMessage', () => {
  it('emits a stream-json user line with one flattened text block', () => {
    const line = buildClaudeStreamJsonUserMessage({
      cachedPrefix: 'CLAUDE.md body',
      prompt: 'ship it',
    });
    expect(line.endsWith('\n')).toBe(true);
    const obj = JSON.parse(line.trim()) as {
      type: string;
      message: { role: string; content: Array<Record<string, unknown>> };
    };
    expect(obj.type).toBe('user');
    expect(obj.message.role).toBe('user');
    expect(obj.message.content).toHaveLength(1);
    expect(obj.message.content[0]).toMatchObject({ type: 'text' });
    expect(String(obj.message.content[0]?.text)).toContain('CLAUDE.md body');
    expect(String(obj.message.content[0]?.text)).toContain('ship it');
  });

  it('does not emit cache_control (Claude Code injects up to 4)', () => {
    const line = buildClaudeStreamJsonUserMessage({
      cachedPrefix: 'stable instructions',
      prompt: 'current turn',
    });
    const obj = JSON.parse(line.trim()) as {
      message: { content: Array<Record<string, unknown>> };
    };
    expect(countCacheControlBlocks(obj.message.content as never)).toBe(0);
    expect(countCacheControlBlocks(obj.message.content as never)).toBeLessThanOrEqual(
      MAX_ANTHROPIC_CACHE_CONTROL_BLOCKS,
    );
  });
});

describe('findInvalidCacheControlTtlOrder', () => {
  it('flags 1h breakpoints that follow 5m ones', () => {
    expect(
      findInvalidCacheControlTtlOrder([
        { cache_control: { type: 'ephemeral' } },
        { content: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ] as never),
    ).toEqual({ index: 1, ttl: '1h' });
  });
});

describe('countCacheControlBlocks', () => {
  it('counts nested cache_control blocks', () => {
    expect(
      countCacheControlBlocks([
        { cache_control: { type: 'ephemeral' } },
        { content: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ] as never),
    ).toBe(2);
  });
});
