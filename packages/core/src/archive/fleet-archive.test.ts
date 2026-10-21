import { describe, expect, it } from 'vitest';
import {
  formatFleetArchive,
  listFleetArchive,
  type ArchiveThread,
} from './fleet-archive.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';

function chat(partial: Partial<ArchiveThread> & Pick<ArchiveThread, 'id'>): ArchiveThread {
  return {
    title: partial.id,
    status: 'archived',
    agent: 'claude',
    repoPath: '/repos/sideboard',
    worktreePath: '/wt/one',
    branchName: 'matt/one',
    sourceType: 'branch',
    sourceRef: 'matt/one',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    archivedAt: '2026-10-03T00:00:00.000Z',
    ...partial,
  };
}

describe('listFleetArchive', () => {
  it('groups a fully archived checkout as one workspace', () => {
    const view = listFleetArchive([
      chat({
        id: 'aaaa1111-impl',
        title: 'Implement',
        createdAt: '2026-10-01T00:00:00.000Z',
        archivedAt: '2026-10-10T00:00:00.000Z',
      }),
      chat({
        id: 'bbbb2222-review',
        title: 'Review',
        agent: 'cursor',
        createdAt: '2026-10-02T00:00:00.000Z',
        archivedAt: '2026-10-11T00:00:00.000Z',
      }),
    ]);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]?.kind).toBe('workspace');
    if (view.rows[0]?.kind !== 'workspace') return;
    expect(view.rows[0].workspace.id).toBe('aaaa1111-impl');
    expect(view.rows[0].workspace.agents.map((agent) => agent.id)).toEqual([
      'aaaa1111-impl',
      'bbbb2222-review',
    ]);
    expect(view.rows[0].workspace.archivedAt).toBe('2026-10-11T00:00:00.000Z');
  });

  it('keeps a closed agent off the workspace list while the checkout is live', () => {
    const view = listFleetArchive([
      chat({ id: 'live-agent', status: 'idle', title: 'Implement' }),
      chat({ id: 'closed-agent', title: 'Review', agent: 'cursor' }),
    ]);
    expect(view.rows.map((row) => row.kind)).toEqual(['agent']);
    if (view.rows[0]?.kind !== 'agent') return;
    expect(view.rows[0].agent.id).toBe('closed-agent');
    expect(view.rows[0].agent.workspaceLive).toBe(true);
  });

  it('lists orchestration chats as agents, not one shared workspace', () => {
    const view = listFleetArchive([
      chat({
        id: 'orch-a',
        title: 'Nightly',
        sourceType: 'orchestration',
        sourceRef: 'Nightly',
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: '/tmp/global',
        branchName: '',
      }),
      chat({
        id: 'orch-b',
        title: 'Inbox',
        sourceType: 'orchestration',
        sourceRef: 'Inbox',
        repoPath: GLOBAL_WORKSPACE_ID,
        worktreePath: '/tmp/global',
        branchName: '',
        archivedAt: '2026-10-04T00:00:00.000Z',
      }),
    ]);
    expect(view.rows.every((row) => row.kind === 'agent')).toBe(true);
    expect(view.rows).toHaveLength(2);
    if (view.rows[0]?.kind !== 'agent') return;
    expect(view.rows[0].agent.repo).toBe('Orchestration');
    expect(view.rows[0].agent.workspaceArchived).toBeUndefined();
  });

  it('flattens archived workspaces when kind is agent', () => {
    const view = listFleetArchive(
      [
        chat({ id: 'impl', title: 'Implement' }),
        chat({ id: 'review', title: 'Review', agent: 'cursor' }),
      ],
      { kind: 'agent' },
    );
    expect(view.rows).toHaveLength(2);
    expect(view.rows.every((row) => row.kind === 'agent' && row.agent.workspaceArchived)).toBe(
      true,
    );
  });

  it('filters by query and reports the hidden remainder', () => {
    const threads = [
      chat({ id: 'keep', title: 'Login bug', archivedAt: '2026-10-12T00:00:00.000Z' }),
      chat({
        id: 'drop',
        title: 'Other',
        worktreePath: '/wt/two',
        branchName: 'matt/two',
        sourceRef: 'matt/two',
        archivedAt: '2026-10-11T00:00:00.000Z',
      }),
    ];
    const matched = listFleetArchive(threads, { query: 'login' });
    expect(matched.total).toBe(1);
    expect(matched.rows[0]?.kind === 'workspace' && matched.rows[0].workspace.title).toBe(
      'Login bug',
    );
    const page = listFleetArchive(threads, { limit: 1 });
    expect(page.shown).toBe(1);
    expect(page.hidden).toBe(1);
    expect(page.rows[0]?.kind === 'workspace' && page.rows[0].workspace.id).toBe('keep');
  });

  it('formats restore hints and full chat links', () => {
    const text = formatFleetArchive(
      listFleetArchive([
        chat({ id: 'aaaa1111-impl', title: 'Implement' }),
        chat({ id: 'orch', title: 'Nightly', sourceType: 'orchestration', repoPath: GLOBAL_WORKSPACE_ID, worktreePath: '/tmp/global' }),
      ]),
    );
    expect(text).toContain('restore_workspace <id>');
    expect(text).toContain('restore_chat <id>');
    expect(text).toContain('sideboard://chat/aaaa1111-impl');
    expect(text).toContain('workspace');
    expect(text).toContain('Orchestration');
  });

  it('says when History is empty or the query misses', () => {
    expect(formatFleetArchive(listFleetArchive([]))).toBe('(archive empty)');
    expect(formatFleetArchive(listFleetArchive([chat({ id: 'a', title: 'Login' })], { query: 'nope' }))).toBe(
      '(no archive matches)',
    );
  });
});
