import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ableTimeDependencyTarget,
  commentAbleTimeTask,
  createAbleTimeTask,
  ensureAbleTimeTask,
  mapAbleTimeTask,
  toAbleTimeIssueInfo,
  updateAbleTimeTask,
} from './abletime.js';
import {
  abletimeMcpUrl,
  ableTimeCredentialKind,
  assertAbleTimeMcpCredential,
  callAbleTimeTool,
  normalizeAbleTimeCredential,
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
    expect(abletimeMcpUrl('https://track.abletime.com/', { pm: true })).toBe(
      'https://track.abletime.com/api/public/v2/mcp/pm',
    );
  });

  it('rewrites agent-access and PAT errors', () => {
    expect(rewriteAbleTimeError('INTEGRATION_AGENT_ACCESS_DISABLED')).toMatch(/Agent access/);
    expect(rewriteAbleTimeError('INTEGRATION_PAT_REQUIRED')).toMatch(/apt_/);
    expect(rewriteAbleTimeError('INTEGRATION_PAT_REQUIRED')).toMatch(/atk_/);
    const invalid = rewriteAbleTimeError('AbleTime MCP error 401: INTEGRATION_KEY_INVALID');
    expect(invalid).toMatch(/unknown, revoked, or expired/);
    expect(invalid).toMatch(/apt_/);
    expect(rewriteAbleTimeError(invalid)).toBe(invalid);
  });

  it('normalizes pasted credentials and keeps org keys off MCP', () => {
    expect(normalizeAbleTimeCredential('  Bearer apt_secret  ')).toBe('apt_secret');
    expect(ableTimeCredentialKind('apt_secret')).toBe('pat');
    expect(ableTimeCredentialKind('atk_org')).toBe('org');
    expect(assertAbleTimeMcpCredential('Bearer apt_secret')).toBe('apt_secret');
    expect(() => assertAbleTimeMcpCredential('atk_org')).toThrow(/atk_/);
  });

  it('maps REST camelCase task and project fields', () => {
    const task = mapAbleTimeTask({
      timeflowTaskId: '01TASKREST0000000000000001',
      taskRef: 'DP-1',
      title: 'REST task',
      taskState: 'todo',
      projectId: '01PROJ',
      lastUpdate: '2026-09-16T00:00:00.000Z',
      tags: ['sideboard'],
    });
    expect(task).toMatchObject({
      id: '01TASKREST0000000000000001',
      identifier: 'DP-1',
      title: 'REST task',
      state: 'todo',
      projectId: '01PROJ',
      labels: ['sideboard'],
      updatedAt: '2026-09-16T00:00:00.000Z',
    });
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
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-09-10T12:00:00.000Z',
    });
    expect(task).toMatchObject({
      id: '01TASK',
      identifier: 'CRM-232',
      title: 'Fix login',
      state: 'todo',
      labels: ['bug'],
      assignee: { name: 'Grant' },
      comments: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
    });
    const withComments = mapAbleTimeTask({
      id: '01TASK',
      reference: 'CRM-232',
      title: 'Fix login',
      comments: [{ id: 'c1', body: 'Looks good', user: { name: 'Ada' } }],
    });
    expect(withComments?.comments).toEqual([
      expect.objectContaining({ id: 'c1', body: 'Looks good', user: 'Ada' }),
    ]);
    expect(toAbleTimeIssueInfo(task!)).toMatchObject({
      identifier: 'CRM-232',
      provider: 'abletime',
      assignee: 'Grant',
    });
  });

  it('maps blockedBy / blocks onto set_task_dependency ids', () => {
    expect(ableTimeDependencyTarget('A', 'blockedBy', 'B')).toEqual({
      taskId: 'A',
      dependsOn: 'B',
    });
    expect(ableTimeDependencyTarget('A', 'blocks', 'B')).toEqual({
      taskId: 'B',
      dependsOn: 'A',
    });
  });
});

describe('callAbleTimeTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it('strips a pasted Bearer prefix on MCP and uses REST for organization keys', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('/api/public/v2/mcp')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: { content: [{ type: 'text', text: '{"ok":true}' }] },
            }),
        };
      }
      const payload = href.includes('/users')
        ? { data: [{ userId: 'u1', username: 'matt', role: 'owner' }], page: {} }
        : href.includes('/projects')
          ? { data: [{ projectId: 'p1', projectName: 'Default', categories: [] }], page: {} }
          : { data: [], page: {} };
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(payload),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    await callAbleTimeTool(
      'orientation',
      {},
      { token: 'Bearer apt_test', host: 'https://track.abletime.com' },
    );
    const mcpInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/public/v2/mcp');
    expect((mcpInit.headers as Record<string, string>).Authorization).toBe('Bearer apt_test');

    fetchMock.mockClear();
    const orientation = await callAbleTimeTool(
      'orientation',
      {},
      { token: 'atk_orgkey', host: 'https://track.abletime.com' },
    );
    expect(orientation).toMatchObject({ viewer: { name: 'matt' } });
    const restUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(restUrls.some((url) => url.includes('/api/public/v2/projects'))).toBe(true);
    expect(restUrls.some((url) => url.includes('/api/public/v2/mcp'))).toBe(false);
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

  it('comments, updates state, and creates a spin-off with parent', async () => {
    const fetchMock = mockTools({
      create_comment: { id: 'c1', body: 'Shipped' },
      set_task_state: { id: 't1', state: 'done' },
      update_task: { id: 't1', reference: 'CRM-232', title: 'Fix login', state: 'done' },
      get_task: { id: 't1', reference: 'CRM-232', title: 'Fix login', state: 'done' },
      orientation: { projects: [{ id: 'p1', name: 'Acme', categories: [] }] },
      create_task: { id: 't3', reference: 'CRM-241', title: 'Follow-up', state: 'todo' },
    });
    const comment = await commentAbleTimeTask(
      { id: 'CRM-232', body: 'Shipped' },
      { token: 'apt_test' },
    );
    expect(comment.body).toBe('Shipped');
    const updated = await updateAbleTimeTask(
      { id: 'CRM-232', state: 'done' },
      { token: 'apt_test' },
    );
    expect(updated.state).toBe('done');
    const spin = await createAbleTimeTask(
      { title: 'Follow-up', parent: 'CRM-232' },
      { token: 'apt_test' },
    );
    expect(spin.identifier).toBe('CRM-241');
    const createCall = fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
      .find((body) => body.params?.name === 'create_task');
    expect(createCall.params.arguments.parent).toBe('CRM-232');
    expect(createCall.params.arguments.description).toMatch(/Spin-off of CRM-232/);
  });

  it('updates labels, project, parent, and a blockedBy dependency', async () => {
    const fetchMock = mockTools({
      orientation: { projects: [{ id: 'p1', name: 'Acme', categories: [] }] },
      update_task: { id: 't1', reference: 'CRM-232', title: 'Fix login', tags: ['bug'] },
      set_task_dependency: { id: 't1', depends_on: 'CRM-8' },
      get_task: {
        id: 't1',
        reference: 'CRM-232',
        title: 'Fix login',
        tags: ['bug'],
        project_id: 'p1',
      },
    });
    const updated = await updateAbleTimeTask(
      {
        id: 'CRM-232',
        labels: ['bug'],
        project: 'Acme',
        parent: 'CRM-1',
        relations: [{ type: 'blockedBy', issue: 'CRM-8' }],
      },
      { token: 'apt_test' },
    );
    expect(updated.labels).toEqual(['bug']);
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as RequestInit).body)) as {
        params?: { name?: string; arguments?: Record<string, unknown> };
      },
    }));
    const update = calls.find((call) => call.body.params?.name === 'update_task');
    expect(update?.body.params?.arguments).toMatchObject({
      tags: ['bug'],
      project_id: 'p1',
      parent: 'CRM-1',
    });
    const dep = calls.find((call) => call.body.params?.name === 'set_task_dependency');
    expect(dep?.url).toContain('/api/public/v2/mcp/pm');
    expect(dep?.body.params?.arguments).toMatchObject({
      task_id: 'CRM-232',
      depends_on: 'CRM-8',
    });
  });
});

describe('AbleTime settings connection', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  it('connects an organization API key over REST', async () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-abletime-org-'));
    vi.resetModules();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const href = String(url);
      const payload = href.includes('/users')
        ? { data: [{ userId: 'u1', username: 'matt', role: 'owner' }], page: {} }
        : href.includes('/projects')
          ? { data: [{ projectId: 'p1', projectName: 'Default', categories: [] }], page: {} }
          : { data: [], page: {} };
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(payload),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { verifyAbleTimeConnection: verify } = await import('./abletime.js');
    const { isAbleTimeConnected, disconnectAbleTimeConnection, loadAppSettings } =
      await import('../store/app-settings.js');
    const viewer = await verify({ token: 'atk_orgkey' });
    expect(viewer.name).toBe('matt');
    expect(isAbleTimeConnected()).toBe(true);
    expect(loadAppSettings().integrations.abletimeAccessToken).toBe('atk_orgkey');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/mcp'))).toBe(false);
    disconnectAbleTimeConnection();
    vi.unstubAllGlobals();
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
