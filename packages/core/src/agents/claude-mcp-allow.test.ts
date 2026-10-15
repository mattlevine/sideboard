import { describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude.js';

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

vi.mock('./orch-mcp-isolation.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./orch-mcp-isolation.js')>();
  return { ...orig, listUserClaudeMcpServerEntries: () => ({}) };
});

const thread = {
  id: 't1',
  agent: 'claude' as const,
  worktreePath: '/tmp/wt',
  repoPath: '/tmp/repo',
  sessionId: null as string | null,
  autonomy: 'default' as const,
  model: null,
  effort: 'high' as const,
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

/** Worktree turns in the app are an RPC request on stdin; CI falls back to `claude -p`. */
function turnOf(cmd: { args: string[]; stdin?: string }): {
  permissionMode?: string;
  allowedTools: string[];
  skipPermissions: boolean;
} {
  const text = cmd.stdin?.trim() ?? '';
  if (text.startsWith('{')) {
    const rpc = JSON.parse(text) as { permissionMode?: string; allowedTools?: string[] };
    return {
      permissionMode: rpc.permissionMode,
      allowedTools: rpc.allowedTools ?? [],
      skipPermissions: rpc.permissionMode === 'bypassPermissions',
    };
  }
  const allowedTools = cmd.args.flatMap((arg, i) =>
    arg === '--allowedTools' && cmd.args[i + 1] ? [cmd.args[i + 1]!] : [],
  );
  return {
    permissionMode: cmd.args[cmd.args.indexOf('--permission-mode') + 1],
    allowedTools,
    skipPermissions: cmd.args.includes('--dangerously-skip-permissions'),
  };
}

describe('claude MCP allow list', () => {
  it('skips permission checks for a full-autonomy turn', async () => {
    const turn = turnOf(
      await claudeAdapter.buildTurn({ ...thread, autonomy: 'full' }, { prompt: 'ship it' }),
    );
    expect(turn.permissionMode).toBe('bypassPermissions');
    expect(turn.skipPermissions).toBe(true);
  });

  it('keeps an MCP server the chat already allowed', async () => {
    const turn = turnOf(
      await claudeAdapter.buildTurn(
        { ...thread, approvedMcpServers: ['gmail'] },
        { prompt: 'check mail' },
      ),
    );
    expect(turn.allowedTools).toContain('mcp__gmail');
    expect(turn.allowedTools).toContain('mcp__gmail__*');
  });
});
