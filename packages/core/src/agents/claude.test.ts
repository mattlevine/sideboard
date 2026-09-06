import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_PROMPT_ARG_MAX, claudeAdapter } from './claude.js';

const claudeSettings = {
  executablePath: undefined as string | undefined,
  chromeEnabled: false,
  linearConnected: false,
  abletimeConnected: false,
};

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

vi.mock('../git/run.js', () => ({
  run: vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'which') return { exitCode: 0, stdout: '/usr/bin/claude', stderr: '' };
    if ((cmd === 'claude' || cmd.endsWith('/claude')) && args[0] === 'mcp') {
      return {
        exitCode: 0,
        stdout: 'claude.ai Brightsy Ai: https://mcp.example/mcp - ✔ Connected\n',
        stderr: '',
      };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }),
}));

beforeEach(() => {
  claudeSettings.executablePath = undefined;
  claudeSettings.chromeEnabled = false;
  claudeSettings.linearConnected = false;
  claudeSettings.abletimeConnected = false;
});

describe('claudeAdapter.buildTurn', () => {
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
  };

  it('uses plan permission mode when planMode is enabled', async () => {
    const cmd = await claudeAdapter.buildTurn(
      { ...baseThread, planMode: true },
      { prompt: 'plan a refactor' },
    );
    expect(cmd.args).toContain('--permission-mode');
    expect(cmd.args[cmd.args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('passes prompt as plain -p arg without stream-json input format', async () => {
    const cmd = await claudeAdapter.buildTurn(baseThread, {
      cachedPrefix: 'seed',
      prompt: 'do thing',
    });
    expect(cmd.args[0]).toBe('-p');
    expect(cmd.args[1]).toContain('seed');
    expect(cmd.args[1]).toContain('do thing');
    expect(cmd.args.includes('--input-format')).toBe(false);
    expect(cmd.args[cmd.args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(cmd.stdin).toBeUndefined();
  });

  it('omits prefix on resumed sessions', async () => {
    const cmd = await claudeAdapter.buildTurn(
      { ...baseThread, sessionId: 'sess-abc' },
      { cachedPrefix: 'should not appear', prompt: 'only this' },
    );
    expect(cmd.args[1]).toBe('only this');
    expect(cmd.args).toContain('--resume');
    expect(cmd.args).toContain('sess-abc');
  });

  it('uses text stdin for oversized prompts', async () => {
    const big = 'x'.repeat(CLAUDE_PROMPT_ARG_MAX + 1);
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: big });
    expect(cmd.args[1]).not.toBe(big);
    expect(cmd.args).toContain('--input-format');
    expect(cmd.args).toContain('text');
    expect(cmd.stdin).toBe(`${big}\n`);
  });

  it('auto-approves WebFetch and WebSearch so headless turns can use the internet', async () => {
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'search docs' });
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('WebFetch');
    expect(allowed).toContain('WebSearch');
    expect(allowed).toContain('Task');
    expect(allowed).toContain('Agent');
    expect(allowed).toContain('TaskOutput');
    expect(allowed).toContain('TaskStop');
    expect(allowed).toContain('EnterWorktree');
    expect(allowed).toContain('Skill');
    expect(cmd.env?.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT).toBe('1');
    expect(cmd.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe('7200000');
  });

  it('passes --chrome and auto-approves Chrome MCP tools when enabled', async () => {
    claudeSettings.chromeEnabled = true;
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'browse' });
    expect(cmd.args).toContain('--chrome');
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('mcp__claude-in-chrome');
    expect(allowed).toContain('mcp__claude-in-chrome__*');
    expect(allowed).toContain('Skill(claude-in-chrome)');
  });

  it('omits Chrome flags and allow-list when Chrome is disabled', async () => {
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'no browser' });
    expect(cmd.args).not.toContain('--chrome');
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).not.toContain('mcp__claude-in-chrome');
  });

  it('uses a custom Claude executable path when configured', async () => {
    claudeSettings.executablePath = '/opt/custom/claude';
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'hi' });
    expect(cmd.file).toBe('/opt/custom/claude');
  });

  it('worktree turns inject Sideboard MCP but only auto-approve present_* UI tools', async () => {
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'make a page' });
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('mcp__sideboard__present_artifact');
    expect(allowed).toContain('mcp__sideboard__present_schema');
    expect(allowed).toContain('mcp__sideboard__present_files');
    expect(allowed).toContain('mcp__sideboard__ask_user');
    expect(allowed).toContain('mcp__sideboard__present_plan');
    expect(allowed).toContain('mcp__sideboard__wait_for_job');
    expect(allowed).toContain('mcp__sideboard__get_viewer_context');
    expect(allowed).toContain('mcp__sideboard__update_viewer_context');
    expect(allowed).toContain('mcp__sideboard__github_*');
    expect(allowed).not.toContain('mcp__sideboard__linear_*');
    expect(allowed).not.toContain('mcp__sideboard__abletime_*');
    expect(allowed).not.toContain('mcp__sideboard__slack_post');
    expect(allowed).not.toContain('mcp__sideboard__list_teams');
    expect(allowed).not.toContain('mcp__sideboard__*');
    expect(cmd.args).not.toContain('--strict-mcp-config');
    expect(cmd.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    const mcpIdx = cmd.args.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThan(-1);
    const cfgPath = cmd.args[mcpIdx + 1];
    expect(cfgPath).toBeTruthy();
    const cfg = JSON.parse(readFileSync(cfgPath!, 'utf8')) as {
      mcpServers: { sideboard: { env?: Record<string, string> } };
    };
    expect(cfg.mcpServers.sideboard.env?.SIDEBOARD_MCP_PROFILE).toBe('worktree');
    const brightsyServers = Object.keys(cfg.mcpServers).filter(
      (n) => n === 'brightsy' || n.startsWith('brightsy_'),
    );
    expect(brightsyServers).toEqual([]);
  });

  it('auto-approves Account Linear and AbleTime tools when those sources are connected', async () => {
    claudeSettings.linearConnected = true;
    claudeSettings.abletimeConnected = true;
    const cmd = await claudeAdapter.buildTurn(baseThread, { prompt: 'comment on the ticket' });
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('mcp__sideboard__github_*');
    expect(allowed).toContain('mcp__sideboard__linear_*');
    expect(allowed).toContain('mcp__sideboard__abletime_*');
  });

  it('orchestrator turns get Sideboard MCP plus Bash/Read (fleet oversight)', async () => {
    const cmd = await claudeAdapter.buildTurn(
      {
        ...baseThread,
        sourceType: 'orchestration' as const,
        repoPath: '__global__',
        worktreePath: '/tmp/global',
      },
      { prompt: 'list threads' },
    );
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('mcp__sideboard');
    expect(allowed).toContain('mcp__sideboard__*');
    expect(allowed).toContain('Bash');
    expect(allowed).toContain('Read');
    expect(cmd.args).not.toContain('--tools');
    expect(cmd.args).not.toContain('--disallowedTools');
    expect(cmd.args).toContain('--strict-mcp-config');
    expect(cmd.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
    const mcpIdx = cmd.args.indexOf('--mcp-config');
    const cfg = JSON.parse(readFileSync(cmd.args[mcpIdx + 1]!, 'utf8')) as {
      mcpServers: { sideboard: { env?: Record<string, string> } };
    };
    expect(cfg.mcpServers.sideboard.env?.SIDEBOARD_MCP_PROFILE).toBe('orchestration');
  });

  it('Global threads keep Sideboard MCP even if sourceType was demoted to branch', async () => {
    const cmd = await claudeAdapter.buildTurn(
      {
        ...baseThread,
        sourceType: 'branch' as const,
        sourceRef: 'Cloud-connected Sideboard orchestrator',
        title: 'Pittsburgh Riverhounds',
        repoPath: '__global__',
        worktreePath: '/tmp/global',
      },
      { prompt: "what's going on" },
    );
    const allowed = cmd.args
      .map((a, i) => (a === '--allowedTools' ? cmd.args[i + 1] : null))
      .filter(Boolean);
    expect(allowed).toContain('mcp__sideboard__*');
    expect(allowed).toContain('Bash');
    expect(cmd.args).toContain('--strict-mcp-config');
    expect(cmd.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
  });
});

describe('claudeAdapter.parseEvent', () => {
  it('extracts session_id from init', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' }),
    );
    expect(event).toEqual({ type: 'session_id', data: 'sess-123' });
  });

  it('surfaces failed MCP servers from system/init so a flap is not silent', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-123',
          mcp_servers: [
            { name: 'sideboard', status: 'connected' },
            { name: 'linear', status: 'failed' },
          ],
        }),
      ),
    ).toEqual([
      { type: 'session_id', data: 'sess-123' },
      { type: 'thinking', data: 'MCP: linear failed', replace: true },
    ]);
  });

  it('does not add MCP thinking when every listed server is connected', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-123',
          mcp_servers: [{ name: 'sideboard', status: 'connected' }],
        }),
      ),
    ).toEqual({ type: 'session_id', data: 'sess-123' });
  });

  it('reads map-shaped mcp_servers from system/init', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-123',
          mcpServers: { linear: { status: 'pending' } },
        }),
      ),
    ).toEqual([
      { type: 'session_id', data: 'sess-123' },
      { type: 'thinking', data: 'MCP: linear pending', replace: true },
    ]);
  });

  it('extracts assistant text even when session_id is present', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-123',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    expect(event).toEqual({ type: 'stdout', data: 'hello' });
  });

  it('extracts result text', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hi there!',
        session_id: 'sess-123',
      }),
    );
    expect(event).toEqual({ type: 'stdout', data: 'Hi there!' });
  });

  it('maps error result events to stderr (credits / limits / API failures)', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'Credit balance is too low',
        session_id: 'sess-123',
      }),
    );
    expect(event).toEqual({ type: 'stderr', data: 'Credit balance is too low' });
  });

  it('maps session-limit result text to stderr even without is_error', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result:
          "You've hit your session limit · resets 7:10pm (America/Los_Angeles)",
        session_id: 'sess-123',
      }),
    );
    expect(event).toEqual({
      type: 'stderr',
      data: "You've hit your session limit · resets 7:10pm (America/Los_Angeles)",
    });
  });

  it('maps error subtype without result text to a readable stderr', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        session_id: 'sess-123',
      }),
    );
    expect(event).toEqual({ type: 'stderr', data: 'max turns' });
  });

  it('extracts usage from the final result event', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hi there!',
        session_id: 'sess-123',
        usage: {
          input_tokens: 120,
          output_tokens: 45,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 300,
        },
      }),
    );
    expect(event).toEqual([
      { type: 'stdout', data: 'Hi there!' },
      {
        type: 'usage',
        data: {
          inputTokens: 120,
          outputTokens: 45,
          cacheReadTokens: 900,
          cacheWriteTokens: 300,
        },
        scope: 'turn',
      },
    ]);
  });

  it('extracts usage-only from a result event with no text', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-123',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 10, outputTokens: 5 },
      scope: 'turn',
    });
  });

  it('extracts total_cost_usd from the final result event when modelUsage is absent', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-123',
        total_cost_usd: 0.042,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 10, outputTokens: 5, costUsd: 0.042 },
      scope: 'turn',
    });
  });

  it('prefers modelUsage costUSD over cumulative total_cost_usd', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-123',
        // Session-cumulative after --resume — must not become this turn's costUsd.
        total_cost_usd: 0.1,
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: {
          'claude-sonnet-4': { inputTokens: 8, outputTokens: 4, costUSD: 0.012 },
          'claude-haiku-4': { inputTokens: 2, outputTokens: 1, costUSD: 0.003 },
        },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 10, outputTokens: 5, costUsd: 0.015 },
      scope: 'turn',
    });
  });

  it('accepts snake_case model_usage / cost_usd aliases', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-123',
        usage: { input_tokens: 10, output_tokens: 5 },
        model_usage: {
          'claude-sonnet-4': { cost_usd: 0.02 },
        },
      }),
    );
    expect(event).toEqual({
      type: 'usage',
      data: { inputTokens: 10, outputTokens: 5, costUsd: 0.02 },
      scope: 'turn',
    });
  });

  it('ignores rate_limit and other non-text events', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'rate_limit_event',
        session_id: 'sess-123',
        rate_limit_info: { status: 'allowed' },
      }),
    );
    expect(event).toBeNull();
  });

  it('extracts text from stream_event content_block_delta', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        },
        session_id: 'sess-123',
      }),
    );
    expect(event).toEqual({ type: 'stdout', data: 'Hi' });
  });

  it('extracts tool_use and thinking from assistant content', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'check git' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'git status' },
            },
          ],
        },
      }),
    );
    expect(event).toEqual([
      { type: 'thinking', data: 'check git' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Bash',
        input: { command: 'git status' },
      },
    ]);
  });

  it('nests Task/Agent subagent messages via parent_tool_use_id', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: 'toolu_task',
        message: {
          content: [
            { type: 'thinking', thinking: 'scan auth' },
            {
              type: 'tool_use',
              id: 'toolu_read',
              name: 'Read',
              input: { file_path: 'src/auth.ts' },
            },
          ],
        },
      }),
    );
    expect(event).toEqual([
      { type: 'thinking', data: 'scan auth', parentId: 'toolu_task' },
      {
        type: 'tool_use',
        id: 'toolu_read',
        name: 'Read',
        input: { file_path: 'src/auth.ts' },
        parentId: 'toolu_task',
      },
    ]);
  });

  it('nests stream_event deltas via parent_tool_use_id', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'stream_event',
          parent_tool_use_id: 'toolu_task',
          event: { type: 'content_block_delta', delta: { thinking: 'scan' } },
        }),
      ),
    ).toEqual({ type: 'thinking', data: 'scan', parentId: 'toolu_task' });
  });

  it('does not steal --resume from nested Agent system/init', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-child',
          parent_tool_use_id: 'toolu_task',
        }),
      ),
    ).toBeNull();
  });

  it('does not treat task_started / task_notification as session_id', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sess-parent',
          tool_use_id: 'toolu_task',
          task_id: 'task_1',
          task_type: 'Agent',
          description: 'scan auth',
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      id: 'toolu_task',
      name: 'Agent',
      input: { description: 'scan auth', task_id: 'task_1' },
    });

    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sess-parent',
          tool_use_id: 'toolu_task',
          status: 'running',
          tool_uses: 4,
          duration_ms: 12_000,
        }),
      ),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_task',
        name: 'Agent',
        input: {
          live_status: 'running',
          live_tool_uses: 4,
          live_duration_ms: 12_000,
        },
      },
      {
        type: 'thinking',
        data: 'running · 4 tools · 12s',
        parentId: 'toolu_task',
        replace: true,
      },
    ]);
  });

  it('maps compact_boundary to a compression notice and post-compact occupancy', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'compact_boundary',
          session_id: 'sess-parent',
          compactMetadata: { trigger: 'auto', preTokens: 820_000, postTokens: 48_000 },
        }),
      ),
    ).toEqual([
      { type: 'thinking', data: 'Context compressed (auto)' },
      {
        type: 'usage',
        data: { inputTokens: 0, outputTokens: 0, lastRequestTokens: 48_000 },
        scope: 'request',
      },
    ]);
  });

  it('maps compacting status to thinking so the stream is not silent', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          session_id: 'sess-parent',
        }),
      ),
    ).toEqual({ type: 'thinking', data: 'Compressing context…', replace: true });
  });

  it('maps api_retry to thinking so long polls still show activity', () => {
    expect(
      claudeAdapter.parseEvent(
        JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          session_id: 'sess-parent',
          attempt: 2,
          max_retries: 5,
          retry_delay_ms: 800,
        }),
      ),
    ).toEqual({ type: 'thinking', data: 'API retry 2/5 (wait 800ms)' });
  });

  it('extracts per-request usage from assistant message.usage', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 500,
            output_tokens: 20,
            cache_read_input_tokens: 80_000,
          },
          content: [{ type: 'text', text: 'ok' }],
        },
      }),
    );
    expect(event).toEqual([
      { type: 'stdout', data: 'ok' },
      {
        type: 'usage',
        data: {
          inputTokens: 500,
          outputTokens: 20,
          cacheReadTokens: 80_000,
        },
        scope: 'request',
      },
    ]);
  });
});
