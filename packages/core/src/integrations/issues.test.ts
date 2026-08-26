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

    vi.spyOn(await import('../git/run.js'), 'gh').mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 12,
          title: 'Fix login',
          url: 'https://github.com/acme/app/issues/12',
          labels: [{ name: 'bug' }],
        },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('github');
    expect(result.preferredSource).toBe('linear');
    expect(result.linearConnected).toBe(false);
    expect(result.issues).toEqual([
      {
        id: 'gh-12',
        identifier: '#12',
        title: 'Fix login',
        url: 'https://github.com/acme/app/issues/12',
        labels: ['bug'],
        provider: 'github',
      },
    ]);
  });

  it('falls back to github when AbleTime is preferred (not connected)', async () => {
    const { settings, issues } = await load();
    settings.updateIntegrationsSettings({ issueSource: 'abletime' });
    expect(settings.getIssueSource()).toBe('abletime');
    expect(settings.resolveEffectiveIssueSource()).toBe('github');

    vi.spyOn(await import('../git/run.js'), 'gh').mockResolvedValue({
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
    });

    const result = await issues.listIssues('/tmp/repo');
    expect(result.source).toBe('github');
    expect(result.preferredSource).toBe('abletime');
    expect(result.issues[0]?.identifier).toBe('#3');
    expect(result.issues[0]?.provider).toBe('github');
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
