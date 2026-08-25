import { describe, expect, it } from 'vitest';
import { foldLivePaintOps, stdoutCountsAsLivePreview } from './live-paint';

describe('stdoutCountsAsLivePreview', () => {
  it('keeps plain assistant text and drops nested/json dumps', () => {
    expect(
      stdoutCountsAsLivePreview({ type: 'stdout', data: 'Hello' }),
    ).toBe(true);
    expect(
      stdoutCountsAsLivePreview({
        type: 'stdout',
        data: 'nested',
        parentId: 'task1',
      }),
    ).toBe(false);
    expect(
      stdoutCountsAsLivePreview({
        type: 'stdout',
        data: '{"type":"tool_use","id":"1"}',
      }),
    ).toBe(false);
  });
});

describe('foldLivePaintOps', () => {
  it('applies a batch of stream ops in order', () => {
    const next = foldLivePaintOps(
      { output: {}, parts: {}, startedAt: {}, usage: {} },
      [
        { kind: 'started', threadId: 'a' },
        {
          kind: 'output',
          threadId: 'a',
          event: { type: 'thinking', data: 'plan ' },
        },
        {
          kind: 'output',
          threadId: 'a',
          event: { type: 'thinking', data: 'this' },
        },
        {
          kind: 'output',
          threadId: 'a',
          event: { type: 'stdout', data: 'Done.' },
        },
      ],
      1_700_000_000_000,
    );
    expect(next.startedAt.a).toBe(1_700_000_000_000);
    expect(next.output.a).toBe('Done.');
    expect(next.parts.a?.map((p) => p.type)).toEqual(['thinking', 'text']);
    expect(next.usage.a).toBeNull();
  });

  it('folds usage and costUsd from stream events', () => {
    const next = foldLivePaintOps(
      { output: {}, parts: {}, startedAt: {}, usage: {} },
      [
        { kind: 'started', threadId: 'a' },
        {
          kind: 'output',
          threadId: 'a',
          event: {
            type: 'usage',
            data: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
            scope: 'request',
          },
        },
        {
          kind: 'output',
          threadId: 'a',
          event: {
            type: 'usage',
            data: { inputTokens: 50, outputTokens: 5, costUsd: 0.02 },
            scope: 'request',
          },
        },
      ],
      1,
    );
    expect(next.usage.a).toMatchObject({
      inputTokens: 150,
      outputTokens: 15,
      costUsd: 0.03,
    });
  });

  it('clears live state after a finished turn', () => {
    const next = foldLivePaintOps(
      {
        output: { a: 'Done.' },
        parts: { a: [{ type: 'text', text: 'Done.' }] },
        startedAt: { a: 1 },
        usage: { a: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 } },
      },
      [{ kind: 'clear', threadId: 'a' }],
      2,
    );
    expect(next.output.a).toBe('');
    expect(next.parts.a).toEqual([]);
    expect(next.startedAt.a).toBeUndefined();
    expect(next.usage.a).toBeUndefined();
  });
});
