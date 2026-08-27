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
});
