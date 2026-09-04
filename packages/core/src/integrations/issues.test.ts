import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('integrations / issues', () => {
  const prevHome = process.env.HOME;
  let home: string;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function load() {
    home = mkdtempSync(join(tmpdir(), 'sb-issues-'));
    process.env.HOME = home;
    return {
      settings: await import('../store/app-settings.js'),
      issues: await import('./issues.js'),
    };
  }

  it('falls back to github when Linear preferred but not connected', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({ issueSource: 'linear' });
    expect(settings.resolveEffectiveIssueSource()).toBe('github');

    vi.spyOn(await import('../git/run.js'), 'gh').mockImplementation(async (args) => {
      if (args[0] === 'api') {
        return { stdout: 'octocat\n', stderr: '', exitCode: 0 };
      }
      return {
        stdout: JSON.stringify([
          {
            number: 12,
            title: 'Fix login',
            url: 'https://github.com/acme/app/issues/12',
            labels: [{ name: 'bug' }],
            assignees: [{ login: 'octocat' }],
          },
        ]),
        stderr: '',
        exitCode: 0,
      };
    });

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('github');
    expect(result.preferredSource).toBe('linear');
    expect(result.linearConnected).toBe(false);
    expect(result.abletimeConnected).toBe(false);
    expect(result.viewer?.login).toBe('octocat');
    expect(result.issues).toEqual([
      {
        id: 'gh-12',
        identifier: '#12',
        title: 'Fix login',
        url: 'https://github.com/acme/app/issues/12',
        labels: ['bug'],
        provider: 'github',
        assignee: 'octocat',
        assignees: ['octocat'],
      },
    ]);
  });

  it('falls back to github when AbleTime is preferred (not connected)', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({ issueSource: 'abletime' });
    expect(settings.getIssueSource()).toBe('abletime');
    expect(settings.resolveEffectiveIssueSource()).toBe('github');

    vi.spyOn(await import('../git/run.js'), 'gh').mockImplementation(async (args) => {
      if (args[0] === 'api') {
        return { stdout: 'octocat\n', stderr: '', exitCode: 0 };
      }
      return {
        stdout: JSON.stringify([
          {
            number: 3,
            title: 'AbleTime fallback',
            url: 'https://github.com/acme/app/issues/3',
            labels: [],
          },
        ]),
        stderr: '',
        exitCode: 0,
      };
    });

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('github');
    expect(result.preferredSource).toBe('abletime');
    expect(result.abletimeConnected).toBe(false);
    expect(result.issues[0]?.identifier).toBe('#3');
    expect(result.issues[0]?.provider).toBe('github');
  });

  it('uses AbleTime when connected and preferred', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({
      abletimeAccessToken: 'apt_test',
      issueSource: 'abletime',
    });
    expect(settings.resolveEffectiveIssueSource()).toBe('abletime');

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { params?: { name?: string } };
      const name = body.params?.name;
      const payload =
        name === 'orientation'
          ? { viewer: { name: 'Grant' }, projects: [] }
          : { data: [{ id: 't1', reference: 'CRM-1', title: 'Track this', state: 'todo' }] };
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('abletime');
    expect(result.abletimeConnected).toBe(true);
    expect(result.issues[0]?.identifier).toBe('CRM-1');
    expect(result.issues[0]?.provider).toBe('abletime');
    expect(result.viewer?.name).toBe('Grant');
  });

  it('uses Linear when connected and preferred', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({
      linearApiKey: 'lin_api_test',
      issueSource: 'linear',
    });
    expect(settings.resolveEffectiveIssueSource()).toBe('linear');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            id: 'user-1',
            name: 'Matt',
            assignedIssues: {
              nodes: [
                {
                  id: 'abc',
                  identifier: 'ENG-1',
                  title: 'Ship it',
                  url: 'https://linear.app/eng-1',
                  labels: { nodes: [{ name: 'p0' }] },
                },
              ],
            },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('linear');
    expect(result.issues[0]?.identifier).toBe('ENG-1');
    expect(result.issues[0]?.provider).toBe('linear');
    expect(fetchMock).toHaveBeenCalled();
    const auth = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })
      ?.headers?.Authorization;
    expect(auth).toBe('lin_api_test');
  });

  it('searches Linear issues that are not assigned to the viewer', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({
      linearApiKey: 'lin_api_test',
      issueSource: 'linear',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: { id: 'user-1', name: 'Matt' },
          searchIssues: {
            nodes: [
              {
                id: 'open',
                identifier: 'ENG-2',
                title: 'Unowned inbox',
                url: 'https://linear.app/eng-2',
                labels: { nodes: [] },
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await issues.listIssues('/tmp/repo', {
      query: 'inbox',
      assignee: 'unassigned',
    });
    expect(result.issues[0]?.identifier).toBe('ENG-2');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      query?: string;
      variables?: { term?: string; filter?: { assignee?: { null?: boolean } } };
    };
    expect(body.query).toContain('SideboardSearchIssues');
    expect(body.variables?.term).toBe('inbox');
    expect(body.variables?.filter?.assignee).toEqual({ null: true });
  });

  it('matches assignee filters including unassigned', async () => {
    const { issues } = await load();
    expect(issues.issueMatchesAssignee({ assignee: undefined }, 'unassigned')).toBe(true);
    expect(issues.issueMatchesAssignee({ assignee: 'Ada', assignees: ['Ada'] }, 'unassigned')).toBe(
      false,
    );
    expect(issues.issueMatchesAssignee({ assignee: 'Ada', assignees: ['Ada'] }, 'me', 'Ada')).toBe(
      true,
    );
    expect(issues.issueMatchesAssignee({ assignee: 'Ada', assignees: ['Ada'] }, 'all')).toBe(true);
  });

  it('passes GitHub unassigned search to gh', async () => {
    const { issues } = await load();
    const gh = vi.spyOn(await import('../git/run.js'), 'gh').mockImplementation(async (args) => {
      if (args[0] === 'api') {
        return { stdout: 'octocat\n', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'issue') {
        expect(args).toContain('--search');
        expect(args[args.indexOf('--search') + 1]).toContain('no:assignee');
        return { stdout: '[]', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await issues.listIssues('/tmp/repo', { assignee: 'unassigned' });
    expect(result.source).toBe('github');
    expect(result.issues).toEqual([]);
    expect(gh).toHaveBeenCalled();
  });
});
