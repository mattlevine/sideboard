import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('listLinearProjects', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('pages project names and includes project on assigned-issue lists', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-projects-'));
    const settings = await import('../store/app-settings.js');
    settings.updateIntegrationsSettings({ linearApiKey: 'lin_api_test' });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        query?: string;
        variables?: { after?: string };
      };
      const query = payload.query ?? '';
      if (query.includes('SideboardAssignedIssues')) {
        expect(query).toContain('project { id name }');
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                id: 'user-1',
                name: 'Matt',
                assignedIssues: {
                  nodes: [
                    {
                      id: 'issue-uuid',
                      identifier: 'ENG-9',
                      title: 'Ship it',
                      url: 'https://linear.app/acme/issue/ENG-9',
                      project: { id: 'proj-1', name: 'Ship' },
                    },
                  ],
                },
              },
            },
          }),
        };
      }
      const node = payload.variables?.after
        ? { id: 'proj-2', name: 'Infra', slugId: 'infra' }
        : { id: 'proj-1', name: 'Ship', slugId: 'ship' };
      return {
        ok: true,
        json: async () => ({
          data: {
            projects: {
              nodes: [node],
              pageInfo: payload.variables?.after
                ? { hasNextPage: false }
                : { hasNextPage: true, endCursor: 'c1' },
            },
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const linear = await import('./linear.js');
    await expect(linear.listLinearProjects()).resolves.toEqual([
      { id: 'proj-1', name: 'Ship', slugId: 'ship' },
      { id: 'proj-2', name: 'Infra', slugId: 'infra' },
    ]);
    const listed = await linear.listLinearAssignedIssues();
    expect(listed.issues[0]?.projects).toEqual([{ id: 'proj-1', name: 'Ship' }]);
  });
});
