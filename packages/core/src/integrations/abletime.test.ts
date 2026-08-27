import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAbleTimeTask,
  mapAbleTimeTask,
  toAbleTimeIssueInfo,
} from './abletime.js';
import {
  abletimeMcpUrl,
  callAbleTimeTool,
  normalizeAbleTimeHost,
  rewriteAbleTimeError,
} from './abletime-mcp.js';

describe('abletime helpers', () => {
  it('normalizes hosts and MCP URLs', () => {
    expect(normalizeAbleTimeHost()).toBe('https://track.abletime.com');
    expect(normalizeAbleTimeHost('track.abletime.com')).toBe('https://track.abletime.com');
    expect(abletimeMcpUrl('https://track.abletime.com/')).toBe(
      'https://track.abletime.com/api/public/v2/mcp',
    );
  });

  it('rewrites agent-access and PAT errors', () => {
    expect(rewriteAbleTimeError('INTEGRATION_AGENT_ACCESS_DISABLED')).toMatch(/Agent access/);
    expect(rewriteAbleTimeError('INTEGRATION_PAT_REQUIRED')).toMatch(/apt_/);
    expect(rewriteAbleTimeError('401 unauthorized')).toMatch(/Reconnect AbleTime/);
  });

  it('maps task payloads with AbleTime field aliases', () => {
    const task = mapAbleTimeTask({
      id: '01TASK',
      reference: 'CRM-232',
      title: 'Fix login',
      url: 'https://track.abletime.com/tasks/CRM-232',
      state: 'todo',
      tags: [{ name: 'bug' }],
      assignee: { name: 'Grant' },
    });
    expect(task).toMatchObject({
      id: '01TASK',
      identifier: 'CRM-232',
      title: 'Fix login',
      state: 'todo',
      labels: ['bug'],
      assignee: { name: 'Grant' },
    });
    expect(toAbleTimeIssueInfo(task!)).toMatchObject({
      identifier: 'CRM-232',
      provider: 'abletime',
      assignee: 'Grant',
    });
  });
});

describe('callAbleTimeTool', () => {
  it('posts tools/call with a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ data: [{ id: '1', title: 'A' }] }) }],
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAbleTimeTool(
      'list_tasks',
      {},
      { token: 'apt_test', host: 'https://track.abletime.com' },
    );
    expect(result).toEqual({ data: [{ id: '1', title: 'A' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://track.abletime.com/api/public/v2/mcp');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer apt_test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'tools/call',
      params: { name: 'list_tasks', arguments: {} },
    });
  });
});

describe('ensureAbleTimeTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockTools(handlers: Record<string, unknown>) {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        method?: string;
        params?: { name?: string };
      };
      const name = body.params?.name ?? '';
      const payload = handlers[name];
      if (payload === undefined) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { message: `unexpected tool ${name}` },
            }),
        };
      }
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
    return fetchMock;
  }

  it('returns an existing open task with the same title', async () => {
    mockTools({
      search_tasks: [{ id: 't1', reference: 'CRM-232', title: 'Fix login', state: 'todo' }],
    });
    const task = await ensureAbleTimeTask(
      { title: 'Fix login' },
      { token: 'apt_test' },
    );
    expect(task.created).toBe(false);
    expect(task.identifier).toBe('CRM-232');
  });

  it('creates a task when none match', async () => {
    mockTools({
      search_tasks: [],
      orientation: { projects: [{ id: 'p1', name: 'Acme', categories: [{ id: 'c1', name: 'Dev' }] }] },
      create_task: { id: 't2', reference: 'CRM-240', title: 'New work', state: 'todo' },
    });
    const task = await ensureAbleTimeTask(
      { title: 'New work' },
      { token: 'apt_test' },
    );
    expect(task.created).toBe(true);
    expect(task.identifier).toBe('CRM-240');
  });
});

describe('AbleTime settings connection', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  it('persists a PAT and treats AbleTime as connected', async () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-abletime-'));
    const settings = await import('../store/app-settings.js');
    const saved = settings.updateIntegrationsSettings({
      abletimeAccessToken: 'apt_test',
      issueSource: 'abletime',
    });
    expect(saved.integrations.abletimeAccessToken).toBe('apt_test');
    expect(settings.isAbleTimeConnected()).toBe(true);
    expect(settings.isIssueSourceConnected('abletime')).toBe(true);
    expect(settings.resolveEffectiveIssueSource()).toBe('abletime');

    const pub = settings.toPublicAppSettings(settings.loadAppSettings());
    expect(pub.integrations.hasAbleTimeToken).toBe(true);
    expect(
      (pub.integrations as { abletimeAccessToken?: string }).abletimeAccessToken,
    ).toBeUndefined();

    settings.disconnectAbleTimeConnection();
    expect(settings.isAbleTimeConnected()).toBe(false);
    expect(settings.resolveEffectiveIssueSource()).toBe('github');
  });
});
