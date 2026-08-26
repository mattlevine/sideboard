import { describe, expect, it } from 'vitest';
import {
  SIDEBOARD_MCP_PROFILE_ENV,
  WORKTREE_MCP_TOOLS,
  sideboardMcpProfile,
} from './profile.js';

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

  it('worktree MCP catalog is the five UI tools only', () => {
    expect([...WORKTREE_MCP_TOOLS]).toEqual([
      'present_artifact',
      'ask_user',
      'present_plan',
      'present_schema',
      'present_files',
    ]);
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_threads');
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_board');
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_teams');
  });
});
