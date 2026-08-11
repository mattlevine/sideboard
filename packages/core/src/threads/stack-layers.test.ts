import { describe, expect, it } from 'vitest';
import { parseGhStackViewJson } from '../git/stack.js';
import { stackIdFrom } from './stack-layers.js';

describe('stackIdFrom', () => {
  it('uses gh stack number when present', () => {
    const stack = parseGhStackViewJson(
      JSON.stringify({
        trunk: 'main',
        currentBranch: 'feat/a',
        stackNumber: 42,
        branches: [
          { name: 'feat/a', isCurrent: true, pr: { number: 1, url: 'https://x/1', state: 'OPEN' } },
          { name: 'feat/b', isCurrent: false, pr: { number: 2, url: 'https://x/2', state: 'OPEN' } },
        ],
      }),
    );
    expect(stack).not.toBeNull();
    expect(stackIdFrom(stack!)).toBe('gh-stack-42');
  });

  it('falls back to a stable local id without stack number', () => {
    const stack = parseGhStackViewJson(
      JSON.stringify({
        trunk: 'main',
        currentBranch: 'feat/a',
        branches: [
          { name: 'feat/a', isCurrent: true },
          { name: 'feat/b', isCurrent: false },
        ],
      }),
    );
    expect(stack).not.toBeNull();
    const id = stackIdFrom(stack!);
    expect(id).toMatch(/^gh-stack-local-/);
    expect(stackIdFrom(stack!)).toBe(id);
  });
});
