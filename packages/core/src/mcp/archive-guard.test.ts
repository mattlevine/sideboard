import { describe, expect, it } from 'vitest';
import { CLOUD_ORCHESTRATOR_GOAL } from '../brightsy/cloud-connect-constants.js';
import { mcpArchiveBlockedReason } from './archive-guard.js';

describe('mcpArchiveBlockedReason', () => {
  it('blocks archiving the cloud coordinator', () => {
    const reason = mcpArchiveBlockedReason({
      sourceType: 'orchestration',
      sourceRef: CLOUD_ORCHESTRATOR_GOAL,
      title: 'Arsenal',
      repoPath: '',
    });
    expect(reason).toMatch(/cloud coordinator/i);
  });

  it('allows archiving ordinary worktree threads', () => {
    expect(
      mcpArchiveBlockedReason({
        sourceType: 'branch',
        sourceRef: 'main',
        title: 'West Ham',
        repoPath: '/tmp/repo',
      }),
    ).toBeNull();
  });

  it('allows archiving non-cloud global chats', () => {
    expect(
      mcpArchiveBlockedReason({
        sourceType: 'orchestration',
        sourceRef: 'Plan the rollout',
        title: 'Plan the rollout',
        repoPath: '',
      }),
    ).toBeNull();
  });
});
