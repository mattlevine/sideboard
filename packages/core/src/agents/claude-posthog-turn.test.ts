import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude.js';
import { setClaudePosthogConnectorForTests } from './claude-posthog-connector.js';

const posthog = { connected: false };

vi.mock('../store/app-settings.js', () => ({
  resolveClaudeExecutable: () => 'claude',
  claudeChromeEnabled: () => false,
  isLinearConnected: () => false,
  isAbleTimeConnected: () => false,
  isPosthogConnected: () => posthog.connected,
  loadAppSettings: () => ({ environment: {}, claude: {} }),
}));

vi.mock('../git/run.js', () => ({
  run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
}));

vi.mock('./orch-mcp-isolation.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./orch-mcp-isolation.js')>();
  return { ...orig, listUserClaudeMcpServerEntries: () => ({}) };
});

vi.mock('../mcp-ui/host.js', () => ({
  proxyClaudeUserMcp: async () => ({}),
}));

const connector = {
  type: 'claudeai-proxy' as const,
  id: 'mcpsrv_posthog',
  url: 'https://mcp-proxy.anthropic.com/v1/mcp/mcpsrv_posthog',
  displayName: 'PostHog',
  alwaysLoad: true,
};

const thread = {
  id: 't1',
  agent: 'claude' as const,
  worktreePath: '/tmp/wt',
  repoPath: '/tmp/repo',
  sessionId: null,
  autonomy: 'default' as const,
  model: null,
  effort: 'high',
  fast: false,
  planMode: false,
  messages: [],
  attachments: [],
  status: 'idle' as const,
  branch: 'main',
  createdAt: '',
  updatedAt: '',
  ref: 't1',
};

function mcpServers(args: string[]): Record<string, { type?: string; id?: string }> {
  const idx = args.indexOf('--mcp-config');
  return JSON.parse(readFileSync(args[idx + 1]!, 'utf8')).mcpServers;
}

describe('claude PostHog connector turn', () => {
  let dataDir = '';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-claude-posthog-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    posthog.connected = false;
    setClaudePosthogConnectorForTests(async () => connector);
  });

  afterEach(() => {
    setClaudePosthogConnectorForTests(undefined);
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('passes the connector when Sideboard PostHog is not signed in', async () => {
    const cmd = await claudeAdapter.buildTurn(thread, { prompt: 'query events' });
    expect(mcpServers(cmd.args)['claude.ai PostHog']).toMatchObject({
      type: 'claudeai-proxy',
      id: 'mcpsrv_posthog',
    });
    expect(cmd.args).toContain('--strict-mcp-config');
    expect(cmd.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    expect(cmd.args[cmd.args.indexOf('--append-system-prompt') + 1]).toMatch(
      /mcp__claude_ai_PostHog__\*/,
    );
    vi.stubEnv('SIDEBOARD_APP_DATA', '/tmp/sporting-jax/.sideboard/dev-app-data');
    const local = await claudeAdapter.buildTurn(thread, { prompt: 'query events' });
    expect(local.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
  });

  it('skips the connector when Sideboard PostHog is connected', async () => {
    posthog.connected = true;
    const cmd = await claudeAdapter.buildTurn(thread, { prompt: 'query events' });
    expect(cmd.args).toContain('mcp__sideboard__posthog_api');
    expect(mcpServers(cmd.args)['claude.ai PostHog']).toBeUndefined();
  });

  it('does not load the connector on orchestrator turns', async () => {
    const cmd = await claudeAdapter.buildTurn(
      { ...thread, sourceType: 'orchestration', repoPath: '__global__', worktreePath: '/tmp/global' },
      { prompt: 'list threads' },
    );
    expect(cmd.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
    expect(mcpServers(cmd.args)['claude.ai PostHog']).toBeUndefined();
  });
});
