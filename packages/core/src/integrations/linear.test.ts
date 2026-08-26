import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLinearIssue,
  commentLinearIssue,
  getLinearIssue,
  linearCycleIsActive,
  listLinearAssignedIssues,
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
    const query = String(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')).query ?? '',
    );
    expect(query).toMatch(/states\s*\(\s*first:\s*50\s*\)/);
    expect(query).toContain('description');
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
