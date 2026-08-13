import { describe, expect, it } from 'vitest';
import { SIDEBOARD_MCP_PROFILE_ENV, sideboardMcpProfile } from './profile.js';

describe('sideboardMcpProfile', () => {
  it('defaults to orchestration (CLI / Cursor MCP keep the fleet)', () => {
    expect(sideboardMcpProfile({})).toBe('orchestration');
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: '' })).toBe(
      'orchestration',
    );
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'orchestration' })).toBe(
      'orchestration',
    );
  });

  it('selects worktree when injected env says so', () => {
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'worktree' })).toBe(
      'worktree',
    );
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'Worktree' })).toBe(
      'worktree',
    );
  });
});
