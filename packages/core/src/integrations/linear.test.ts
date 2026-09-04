import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLinearIssueFilter,
  createLinearIssue,
  commentLinearIssue,
  flipLinearRelationType,
  getLinearIssue,
  linearCycleIsActive,
  listLinearAssignedIssues,
  listLinearIssuesFiltered,
  listLinearTeams,
  resolveLinearState,
  resolveLinearTeam,
  rewriteLinearError,
  updateLinearIssue,
  type LinearTeam,
} from './linear.js';

const TEAM: LinearTeam = {
  id: 'team-1',
  key: 'ENG',
  name: 'Engineering',
  states: [
    { id: 'state-todo', name: 'Todo', type: 'unstarted' },
    { id: 'state-doing', name: 'In Progress', type: 'started' },
    { id: 'state-done', name: 'Done', type: 'completed' },
  ],
};

function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-uuid',
    identifier: 'ENG-9',
    title: 'Ship it',
    url: 'https://linear.app/acme/issue/ENG-9',
    description: 'Body',
    priority: 2,
    state: { id: 'state-todo', name: 'Todo', type: 'unstarted' },
    assignee: { id: 'user-1', name: 'Matt' },
    team: {
      id: TEAM.id,
      key: TEAM.key,
      name: TEAM.name,
      states: { nodes: TEAM.states },
    },
    labels: { nodes: [{ name: 'p0' }] },
    creator: { id: 'user-2', name: 'Ada' },
    project: { id: 'proj-1', name: 'Ship' },
    estimate: 3,
    dueDate: '2026-09-10',
    branchName: 'matt/eng-9-ship-it',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    parent: {
      id: 'parent-uuid',
      identifier: 'ENG-1',
      title: 'Epic',
      url: 'https://linear.app/acme/issue/ENG-1',
    },
    children: {
      nodes: [
        {
          id: 'child-uuid',
          identifier: 'ENG-11',
          title: 'Subtask',
          url: 'https://linear.app/acme/issue/ENG-11',
        },
      ],
    },
    relations: {
      nodes: [
        {
          type: 'blocks',
          relatedIssue: {
            id: 'blocked-uuid',
            identifier: 'ENG-8',
            title: 'Depends on ship',
            url: 'https://linear.app/acme/issue/ENG-8',
          },
        },
      ],
    },
    inverseRelations: {
      nodes: [
        {
          type: 'blocks',
          issue: {
            id: 'blocker-uuid',
            identifier: 'ENG-2',
            title: 'Unblock ship',
            url: 'https://linear.app/acme/issue/ENG-2',
          },
        },
      ],
    },
    comments: {
      nodes: [
        {
          id: 'c-1',
          body: 'Looks good',
          url: 'https://linear.app/c-1',
          createdAt: '2026-09-01T12:00:00.000Z',
          user: { id: 'user-2', name: 'Ada' },
        },
      ],
    },
    attachments: {
      nodes: [{ id: 'att-1', title: 'Spec', url: 'https://example.com/spec', subtitle: 'doc' }],
    },
    ...overrides,
  };
}

describe('resolveLinearTeam / resolveLinearState', () => {
  it('matches team by key, name, or id (case-insensitive)', () => {
    expect(resolveLinearTeam([TEAM], 'eng').id).toBe('team-1');
    expect(resolveLinearTeam([TEAM], 'Engineering').key).toBe('ENG');
    expect(resolveLinearTeam([TEAM], 'team-1').key).toBe('ENG');
  });

  it('matches state by name, type, or id', () => {
    expect(resolveLinearState(TEAM, 'In Progress').id).toBe('state-doing');
    expect(resolveLinearState(TEAM, 'started').id).toBe('state-doing');
    expect(resolveLinearState(TEAM, 'state-done').name).toBe('Done');
  });
});

describe('linearCycleIsActive', () => {
  it('is true between startsAt and endsAt when not completed', () => {
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    expect(
      linearCycleIsActive(
        {
          startsAt: '2026-08-24T00:00:00.000Z',
          endsAt: '2026-08-31T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(true);
    expect(
      linearCycleIsActive(
        {
          startsAt: '2026-08-24T00:00:00.000Z',
          endsAt: '2026-08-31T00:00:00.000Z',
          completedAt: '2026-08-25T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
    expect(
      linearCycleIsActive(
        {
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-09-08T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('flipLinearRelationType', () => {
  it('flips incoming inverse relation types to this issue\'s view', () => {
    expect(flipLinearRelationType('blocks')).toBe('blockedBy');
    expect(flipLinearRelationType('blockedBy')).toBe('blocks');
    expect(flipLinearRelationType('duplicate')).toBe('duplicateOf');
    expect(flipLinearRelationType('related')).toBe('related');
  });
});

describe('buildLinearIssueFilter', () => {
  it('filters me, unassigned, all, and named users', () => {
    expect(buildLinearIssueFilter()).toEqual({
      state: { type: { nin: ['completed', 'canceled'] } },
      assignee: { isMe: true },
    });
    expect(buildLinearIssueFilter({ assignee: 'unassigned' }).assignee).toEqual({ null: true });
    expect(buildLinearIssueFilter({ assignee: 'all' }).assignee).toBeUndefined();
    expect(buildLinearIssueFilter({ assignee: 'user-uuid-not-valid' }).assignee).toEqual({
      name: { eqIgnoreCase: 'user-uuid-not-valid' },
    });
    expect(
      buildLinearIssueFilter({ assignee: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }).assignee,
    ).toEqual({ id: { eq: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } });
  });
});

describe('rewriteLinearError', () => {
  it('tells the user to reconnect when the token lacks write scope', () => {
    expect(rewriteLinearError('Insufficient scope for this operation')).toContain(
      'Disconnect and Connect Linear',
    );
  });
});

describe('Linear GraphQL writes', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function withAuth() {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-write-'));
    const settings = await import('../store/app-settings.js');
    settings.updateIntegrationsSettings({ linearApiKey: 'lin_api_test' });
  }

  function mockGraphql(handler: (query: string, variables: Record<string, unknown>) => unknown) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      const data = handler(payload.query ?? '', payload.variables ?? {});
      return {
        ok: true,
        json: async () => ({ data }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('lists teams and viewer for create/assign', async () => {
    await withAuth();
    mockGraphql(() => ({
      viewer: { id: 'user-1', name: 'Matt' },
      teams: { nodes: [{ ...TEAM, states: { nodes: TEAM.states } }] },
    }));
    const result = await listLinearTeams();
    expect(result.viewer.id).toBe('user-1');
    expect(result.teams[0]?.key).toBe('ENG');
    expect(result.teams[0]?.states[1]?.type).toBe('started');
  });

  it('creates an issue resolving team key, state name, and assignee me', async () => {
    await withAuth();
    const fetchMock = mockGraphql((query, variables) => {
      if (query.includes('SideboardTeams')) {
        return {
          viewer: { id: 'user-1', name: 'Matt' },
          teams: { nodes: [{ ...TEAM, states: { nodes: TEAM.states } }] },
        };
      }
      if (query.includes('SideboardIssueCreate')) {
        const input = variables.input as Record<string, unknown>;
        expect(input.teamId).toBe('team-1');
        expect(input.title).toBe('New bug');
        expect(input.stateId).toBe('state-doing');
        expect(input.assigneeId).toBe('user-1');
        expect(input.priority).toBe(1);
        return {
          issueCreate: {
            success: true,
            issue: issueNode({ title: 'New bug', identifier: 'ENG-10' }),
          },
        };
      }
      throw new Error(`unexpected query ${query.slice(0, 40)}`);
    });
    const issue = await createLinearIssue({
      team: 'ENG',
      title: 'New bug',
      description: 'Repro steps',
      state: 'In Progress',
      assignee: 'me',
      priority: 1,
    });
    expect(issue.identifier).toBe('ENG-10');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('updates an issue by identifier and resolves state type', async () => {
    await withAuth();
    mockGraphql((query, variables) => {
      if (query.includes('SideboardIssueUpdate')) {
        expect(variables.id).toBe('ENG-9');
        expect((variables.input as { stateId?: string }).stateId).toBe('state-done');
        expect((variables.input as { title?: string }).title).toBe('Shipped');
        return {
          issueUpdate: {
            success: true,
            issue: issueNode({
              title: 'Shipped',
              state: { id: 'state-done', name: 'Done', type: 'completed' },
            }),
          },
        };
      }
      if (query.includes('SideboardIssue')) {
        return { issue: issueNode() };
      }
      throw new Error(`unexpected query ${query.slice(0, 80)}`);
    });
    const issue = await updateLinearIssue({
      id: 'ENG-9',
      title: 'Shipped',
      state: 'completed',
    });
    expect(issue.title).toBe('Shipped');
    expect(issue.state?.type).toBe('completed');
  });

  it('comments on an issue', async () => {
    await withAuth();
    mockGraphql((_query, variables) => {
      expect((variables.input as { issueId?: string }).issueId).toBe('ENG-9');
      return {
        commentCreate: {
          success: true,
          comment: { id: 'c1', body: 'Done', url: 'https://linear.app/c1' },
        },
      };
    });
    const comment = await commentLinearIssue({ id: 'ENG-9', body: 'Done' });
    expect(comment.id).toBe('c1');
    expect(comment.url).toBe('https://linear.app/c1');
  });

  it('gets an issue by identifier', async () => {
    await withAuth();
    const fetchMock = mockGraphql(() => ({ issue: issueNode() }));
    const issue = await getLinearIssue('ENG-9');
    expect(issue.identifier).toBe('ENG-9');
    expect(issue.team?.key).toBe('ENG');
    expect(issue.creator?.name).toBe('Ada');
    expect(issue.project).toEqual({ id: 'proj-1', name: 'Ship' });
    expect(issue.estimate).toBe(3);
    expect(issue.parent?.identifier).toBe('ENG-1');
    expect(issue.children).toEqual([
      expect.objectContaining({ identifier: 'ENG-11', title: 'Subtask' }),
    ]);
    expect(issue.relations).toEqual([
      {
        type: 'blocks',
        issue: expect.objectContaining({ identifier: 'ENG-8' }),
      },
      {
        type: 'blockedBy',
        issue: expect.objectContaining({ identifier: 'ENG-2' }),
      },
    ]);
    expect(issue.comments).toEqual([
      expect.objectContaining({
        id: 'c-1',
        body: 'Looks good',
        user: { id: 'user-2', name: 'Ada' },
      }),
    ]);
    expect(issue.attachments).toEqual([
      expect.objectContaining({ id: 'att-1', title: 'Spec', url: 'https://example.com/spec' }),
    ]);
    const query = String(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')).query ?? '',
    );
    expect(query).toMatch(/states\s*\(\s*first:\s*50\s*\)/);
    expect(query).toContain('description');
    expect(query).toMatch(/comments\s*\(\s*first:\s*50\s*\)/);
    expect(query).toMatch(/relations\s*\(\s*first:\s*25\s*\)/);
    expect(query).toMatch(/inverseRelations\s*\(\s*first:\s*25\s*\)/);
    expect(query).toContain('parent');
    expect(query).toMatch(/children\s*\(\s*first:\s*25\s*\)/);
  });

  it('lists assigned issues with the active cycle mapped', async () => {
    await withAuth();
    const fetchMock = mockGraphql(() => ({
      viewer: {
        id: 'user-1',
        name: 'Matt',
        assignedIssues: {
          nodes: [
            issueNode({
              cycle: {
                id: 'c1',
                name: 'Week 34',
                number: 34,
                startsAt: '2020-01-01T00:00:00.000Z',
                endsAt: '2099-01-01T00:00:00.000Z',
              },
            }),
          ],
        },
      },
    }));
    const listed = await listLinearAssignedIssues();
    expect(listed.viewer.name).toBe('Matt');
    expect(listed.issues[0]).toMatchObject({
      identifier: 'ENG-9',
      assignee: 'Matt',
      teamKey: 'ENG',
      cycle: { name: 'Week 34', number: 34, isActive: true },
    });
    const query = String(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')).query ?? '',
    );
    expect(query).toContain('SideboardAssignedIssues');
    expect(query).toMatch(/labels\s*\(\s*first:\s*10\s*\)/);
    expect(query).not.toMatch(/states\s*(\(|\{)/);
    expect(query).not.toContain('description');
    expect(query).not.toMatch(/comments\s*\(/);
    expect(query).not.toMatch(/relations\s*\(/);
  });

  it('lists unassigned issues and searches beyond the current viewer', async () => {
    await withAuth();
    const fetchMock = mockGraphql((query, variables) => {
      if (query.includes('SideboardSearchIssues')) {
        expect(variables.filter).toEqual({
          state: { type: { nin: ['completed', 'canceled'] } },
        });
        expect(variables.term).toBe('inbox');
        return {
          viewer: { id: 'user-1', name: 'Matt' },
          searchIssues: { nodes: [issueNode({ assignee: null, title: 'Inbox' })] },
        };
      }
      expect(query).toContain('SideboardIssues');
      expect(variables.filter).toEqual({
        state: { type: { nin: ['completed', 'canceled'] } },
        assignee: { null: true },
      });
      return {
        viewer: { id: 'user-1', name: 'Matt' },
        issues: { nodes: [issueNode({ assignee: null, title: 'No owner' })] },
      };
    });
    const unassigned = await listLinearIssuesFiltered({ assignee: 'unassigned' });
    expect(unassigned.issues[0]?.title).toBe('No owner');
    expect(unassigned.issues[0]?.assignee).toBeUndefined();
    const searched = await listLinearIssuesFiltered({ query: 'inbox' });
    expect(searched.issues[0]?.title).toBe('Inbox');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rewrites GraphQL permission errors', async () => {
    await withAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [{ message: 'You do not have permission to perform this action' }],
        }),
      }),
    );
    await expect(getLinearIssue('ENG-1')).rejects.toThrow(/Disconnect and Connect Linear/);
  });
});
