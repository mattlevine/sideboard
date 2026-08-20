import { describe, expect, it } from 'vitest';
import { threadStatusKind } from './thread-status-kind';

describe('threadStatusKind', () => {
  it('prefers running over uncommitted git', () => {
    expect(threadStatusKind('running', true)).toBe('running');
  });

  it('prefers error over uncommitted git', () => {
    expect(threadStatusKind('error', true)).toBe('error');
    expect(threadStatusKind('broken', false)).toBe('error');
  });

  it('shows git dirty when idle or stopped', () => {
    expect(threadStatusKind('idle', true)).toBe('dirty');
    expect(threadStatusKind('stopped', true)).toBe('dirty');
  });

  it('is idle when clean', () => {
    expect(threadStatusKind('idle', false)).toBe('idle');
    expect(threadStatusKind('queued', false)).toBe('queued');
  });
});
