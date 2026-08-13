import { describe, expect, it } from 'vitest';
import {
  parseGhStackViewJson,
  stackMergeReadiness,
} from './stack.js';

const FIXTURE = {
  trunk: 'main',
  currentBranch: 'feat/api',
  stackNumber: 7,
  branches: [
    {
      name: 'feat/auth',
      head: 'aaa',
      base: 'trunksha',
      isCurrent: false,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      pr: { number: 10, url: 'https://github.com/o/r/pull/10', state: 'OPEN', title: 'Auth' },
    },
    {
      name: 'feat/api',
      head: 'bbb',
      base: 'aaa',
      isCurrent: true,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      pr: { number: 11, url: 'https://github.com/o/r/pull/11', state: 'OPEN', title: 'API' },
    },
    {
      name: 'feat/ui',
      head: 'ccc',
      base: 'bbb',
      isCurrent: false,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      pr: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', title: 'UI' },
    },
  ],
};

describe('parseGhStackViewJson', () => {
  it('parses bottom→top layers and current index', () => {
    const stack = parseGhStackViewJson(JSON.stringify(FIXTURE));
    expect(stack).not.toBeNull();
    expect(stack!.trunk).toBe('main');
    expect(stack!.stackNumber).toBe(7);
    expect(stack!.layers).toHaveLength(3);
    expect(stack!.layers[0]!.position).toBe(1);
    expect(stack!.layers[0]!.prNumber).toBe(10);
    expect(stack!.layers[1]!.isCurrent).toBe(true);
    expect(stack!.currentIndex).toBe(1);
    expect(stack!.readyToMerge).toBe(true);
    expect(stack!.blockedReason).toBeNull();
  });

  it('returns null for empty or invalid JSON', () => {
    expect(parseGhStackViewJson('')).toBeNull();
    expect(parseGhStackViewJson('{}')).toBeNull();
    expect(parseGhStackViewJson('not-json')).toBeNull();
  });
});

describe('stackMergeReadiness', () => {
  it('blocks when a lower layer needs rebase', () => {
    const stack = parseGhStackViewJson(JSON.stringify(FIXTURE))!;
    stack.layers[0]!.needsRebase = true;
    const r = stackMergeReadiness(stack.layers, 1);
    expect(r.readyToMerge).toBe(false);
    expect(r.blockedReason).toMatch(/needs rebase/i);
  });

  it('blocks when a lower layer has no PR', () => {
    const stack = parseGhStackViewJson(JSON.stringify(FIXTURE))!;
    stack.layers[0]!.prNumber = null;
    const r = stackMergeReadiness(stack.layers, 1);
    expect(r.readyToMerge).toBe(false);
    expect(r.blockedReason).toMatch(/no pull request/i);
  });

  it('skips already-merged lower layers', () => {
    const stack = parseGhStackViewJson(JSON.stringify(FIXTURE))!;
    stack.layers[0]!.isMerged = true;
    stack.layers[0]!.prState = 'MERGED';
    const r = stackMergeReadiness(stack.layers, 1);
    expect(r.readyToMerge).toBe(true);
  });

  it('treats QUEUED lower layers as still mergeable', () => {
    const stack = parseGhStackViewJson(JSON.stringify(FIXTURE))!;
    stack.layers[0]!.isQueued = true;
    stack.layers[0]!.prState = 'QUEUED';
    const r = stackMergeReadiness(stack.layers, 1);
    expect(r.readyToMerge).toBe(true);
  });
});
