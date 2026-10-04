import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAdapter } from './claude.js';
import { claudeRunnerPath } from './claude-host.js';
import type { Thread } from '../types/thread.js';
import { AGENT_RPC_NATIVE_ENV, AGENT_RPC_CLAUDE_SDK_SERVER } from '../agent-rpc/protocol.js';
import { withClaudePilotRpcTools } from './claude-host.js';

const claudeSettings = {
  executablePath: undefined as string | undefined,
  chromeEnabled: false,
  linearConnected: false,
  abletimeConnected: false,
};

const userClaudeMcpEntries: Record<string, Record<string, unknown>> = {};

vi.mock('../store/app-settings.js', () => ({
  resolveClaudeExecutable: () => claudeSettings.executablePath || 'claude',
  claudeChromeEnabled: () => Boolean(claudeSettings.chromeEnabled),
  isLinearConnected: () => Boolean(claudeSettings.linearConnected),
  isAbleTimeConnected: () => Boolean(claudeSettings.abletimeConnected),
  loadAppSettings: () => ({
    environment: {},
    claude: {
      executablePath: claudeSettings.executablePath,
      chromeEnabled: claudeSettings.chromeEnabled,
    },
  }),
}));

vi.mock('./orch-mcp-isolation.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./orch-mcp-isolation.js')>();
  return {
    ...orig,
    listUserClaudeMcpServerEntries: () => ({ ...userClaudeMcpEntries }),
  };
});

vi.mock('../git/run.js', () => ({
  run: vi.fn(async (cmd: string, _args: string[]) => {
    if (cmd === 'which') return { exitCode: 0, stdout: '/usr/bin/claude', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  }),
}));

const baseThread = {
  id: 't1',
  agent: 'claude' as const,
  worktreePath: '/tmp/wt',
  repoPath: '/tmp/repo',
  sessionId: null as string | null,
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
} as Thread;

describe('Claude Agent RPC worktree hook', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-claude-rpc-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    vi.stubEnv('SIDEBOARD_SECRET_VAULT', 'plain');
    claudeSettings.chromeEnabled = false;
    for (const key of Object.keys(userClaudeMcpEntries)) delete userClaudeMcpEntries[key];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('swaps MCP pilot names for the in-process SDK server', () => {
    const swapped = withClaudePilotRpcTools([
      'mcp__sideboard__present_artifact',
      'mcp__sideboard__wait_for_job',
      'mcp__sideboard__ask_user',
    ]);
    expect(swapped).toContain(`mcp__${AGENT_RPC_CLAUDE_SDK_SERVER}__present_artifact`);
    expect(swapped).toContain(`mcp__${AGENT_RPC_CLAUDE_SDK_SERVER}__wait_for_job`);
    expect(swapped).not.toContain('mcp__sideboard__present_artifact');
    expect(swapped).toContain('mcp__sideboard__ask_user');
  });

  it('spawns the Claude runner and omits MCP pilots when the desktop runtime is live', async () => {
    const { writeAgentRuntimeMetadata } = await import('../agent-rpc/metadata.js');
    const { AGENT_RPC_PROTOCOL_VERSION } = await import('../agent-rpc/protocol.js');
    const url = 'ws://127.0.0.1:9/agent-rpc';
    writeAgentRuntimeMetadata({
      runtimeId: 'rt',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'tok',
      startedAt: 1,
      transports: [{ kind: 'websocket', url }],
    });
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'hi' });
    const runner = cmd.args.find((a) => /claude-runner\.(js|cjs|ts)$/.test(a));
    expect(runner).toBeDefined();
    expect(existsSync(runner!)).toBe(true);
    expect(runner).not.toMatch(/apps[/\\]desktop[/\\]claude-runner/);
    const req = JSON.parse(cmd.stdin!) as {
      agentRpc?: { url: string; authToken: string };
      allowedTools: string[];
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    expect(req.agentRpc).toEqual({ url, authToken: 'tok' });
    expect(req.allowedTools).toContain(`mcp__${AGENT_RPC_CLAUDE_SDK_SERVER}__present_artifact`);
    expect(req.allowedTools).not.toContain('mcp__sideboard__present_artifact');
    expect(req.mcpServers?.sideboard?.env?.[AGENT_RPC_NATIVE_ENV]).toBe('1');
  });

  it('copies user ~/.claude.json MCP into the RPC servers and keeps them off ~/.claude settings', async () => {
    userClaudeMcpEntries.gmail = { command: 'npx', args: ['-y', 'gmail'] };
    const { writeAgentRuntimeMetadata } = await import('../agent-rpc/metadata.js');
    const { AGENT_RPC_PROTOCOL_VERSION } = await import('../agent-rpc/protocol.js');
    writeAgentRuntimeMetadata({
      runtimeId: 'rt',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'tok',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'hi' });
    const req = JSON.parse(cmd.stdin!) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
      allowedTools: string[];
      isolateClaudeAiMcp?: boolean;
    };
    expect(req.mcpServers?.gmail).toEqual({ command: 'npx', args: ['-y', 'gmail'] });
    expect(req.allowedTools).toContain('mcp__gmail');
    expect(req.isolateClaudeAiMcp).toBe(false);
  });

  it('still copies user MCP on local-dev RPC turns while isolating claude.ai', async () => {
    userClaudeMcpEntries.gmail = { command: 'npx', args: ['-y', 'gmail'] };
    vi.stubEnv('SIDEBOARD_APP_DATA', join(dataDir, '.sideboard', 'dev-app-data'));
    const { writeAgentRuntimeMetadata } = await import('../agent-rpc/metadata.js');
    const { AGENT_RPC_PROTOCOL_VERSION } = await import('../agent-rpc/protocol.js');
    writeAgentRuntimeMetadata({
      runtimeId: 'rt',
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'tok',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'hi' });
    const req = JSON.parse(cmd.stdin!) as {
      mcpServers?: Record<string, { command?: string }>;
      isolateClaudeAiMcp?: boolean;
    };
    expect(req.mcpServers?.gmail?.command).toBe('npx');
    expect(req.isolateClaudeAiMcp).toBe(true);
  });

  it('keeps the Claude CLI and MCP pilots when the desktop pid is dead', async () => {
    const { writeAgentRuntimeMetadata } = await import('../agent-rpc/metadata.js');
    const { AGENT_RPC_PROTOCOL_VERSION } = await import('../agent-rpc/protocol.js');
    writeAgentRuntimeMetadata({
      runtimeId: 'rt-stale',
      pid: 4_194_303,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken: 'stale',
      startedAt: 1,
      transports: [{ kind: 'websocket', url: 'ws://127.0.0.1:9/agent-rpc' }],
    });
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'hi' });
    expect(cmd.file).toBe('claude');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('mcp__sideboard__present_artifact');
  });

  it('resolves the Claude runner next to core, not desktop cwd', () => {
    const runner = claudeRunnerPath();
    expect(runner).toMatch(/claude-runner\.(js|cjs|ts)$/);
    expect(existsSync(runner)).toBe(true);
    expect(runner).not.toMatch(/apps[/\\]desktop[/\\]claude-runner/);
  });
});
