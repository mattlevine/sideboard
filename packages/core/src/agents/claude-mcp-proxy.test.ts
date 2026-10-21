import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude.js';

const userClaudeMcpEntries: Record<string, Record<string, unknown>> = {};

vi.mock('../store/app-settings.js', () => ({
  resolveClaudeExecutable: () => 'claude',
  claudeChromeEnabled: () => false,
  isLinearConnected: () => false,
  isAbleTimeConnected: () => false,
  isPosthogConnected: () => false,
  loadAppSettings: () => ({ environment: {}, claude: {} }),
}));

vi.mock('../git/run.js', () => ({
  run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
}));

vi.mock('../mcp-ui/host.js', () => ({
  proxyClaudeUserMcp: async (orchestrator: boolean) =>
    orchestrator
      ? {}
      : Object.fromEntries(
          Object.keys(userClaudeMcpEntries).map((name) => [
            name,
            {
              type: 'http',
              url: `http://127.0.0.1:9/s/${encodeURIComponent(name)}`,
              headers: { Authorization: 'Bearer t' },
            },
          ]),
        ),
}));

describe('Claude user MCP proxy', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-claude-proxy-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    for (const key of Object.keys(userClaudeMcpEntries)) delete userClaudeMcpEntries[key];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('points worktree Claude at the loopback host and auto-approves those servers', async () => {
    userClaudeMcpEntries.gmail = { command: 'npx', args: ['-y', 'gmail'] };
    const cmd = await claudeAdapter.buildTurn(
      {
        id: 't1',
        agent: 'claude',
        worktreePath: '/tmp/wt',
        repoPath: '/tmp/repo',
        sessionId: null,
        autonomy: 'default',
        model: null,
        effort: 'high',
        fast: false,
        planMode: false,
        messages: [],
        attachments: [],
        status: 'idle',
        branch: 'main',
        createdAt: '',
        updatedAt: '',
        ref: 't1',
      },
      { prompt: 'hi' },
    );
    const allowed = cmd.args.flatMap((arg, i) =>
      arg === '--allowedTools' && cmd.args[i + 1] ? [cmd.args[i + 1]] : [],
    );
    expect(allowed).toContain('mcp__gmail');
    expect(allowed).toContain('mcp__gmail__*');
    const cfg = JSON.parse(readFileSync(cmd.args[cmd.args.indexOf('--mcp-config') + 1]!, 'utf8')) as {
      mcpServers: Record<string, { command?: string; url?: string; type?: string }>;
    };
    expect(cfg.mcpServers.gmail?.command).toBeUndefined();
    expect(cfg.mcpServers.gmail?.type).toBe('http');
    expect(cfg.mcpServers.gmail?.url).toMatch(/^http:\/\/127\.0\.0\.1:9\/s\/gmail$/);
    expect(cfg.mcpServers.sideboard).toBeTruthy();
  });
});
