import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveRunScriptThreadRef } from './run-script-ref.js';

vi.mock('../threads/chat-tabs.js', () => ({
  threadsSharingWorktree: vi.fn(),
}));

import { threadsSharingWorktree } from '../threads/chat-tabs.js';

const sharing = vi.mocked(threadsSharingWorktree);

describe('resolveRunScriptThreadRef', () => {
  beforeEach(() => {
    sharing.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers an explicit ref', () => {
    expect(resolveRunScriptThreadRef('  abc-123  ')).toBe('abc-123');
    expect(sharing).not.toHaveBeenCalled();
  });

  it('resolves from cwd when ref is omitted', () => {
    sharing.mockReturnValue([{ id: 'wt-thread' } as never]);
    expect(resolveRunScriptThreadRef()).toBe('wt-thread');
    expect(sharing).toHaveBeenCalledWith(process.cwd());
  });

  it('throws when cwd has no live thread', () => {
    sharing.mockReturnValue([]);
    expect(() => resolveRunScriptThreadRef(undefined)).toThrow(/No Sideboard thread/);
  });
});
