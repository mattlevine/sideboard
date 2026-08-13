import { existsSync } from 'node:fs';
import { run } from '../git/run.js';
import {
  claudeChromeEnabled,
  resolveClaudeExecutable,
} from '../store/app-settings.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { mcpAllowTools, parseMcpList } from './claude-mcp.js';
import { looksLikeAgentFailureMessage } from './error-detail.js';
import {
  brightsyMcpAllowedTools,
  buildInjectedMcpServers,
  SIDEBOARD_ARTIFACT_MCP_ALLOWED_TOOLS,
  SIDEBOARD_MCP_ALLOWED_TOOLS,
  shouldInjectBrightsyMcp,
  writeMcpServersConfig,
} from './injected-mcp.js';
import { dropCachedPrefixOnResume, flattenTurnInput } from './turn-input.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';
import { permissionMode } from './types.js';

/**
 * Tools Sideboard auto-approves on every Claude turn.
 * `--allowedTools` does not restrict availability — it skips permission prompts.
 * Non-interactive `-p` turns have no TTY dialog, so anything not listed here
 * (with default `acceptEdits` autonomy) is denied. Include web tools so agents
 * can search/fetch without requiring Full autonomy / bypassPermissions.
 */
const BASE_ALLOWED_TOOLS = [
  'Edit',
  'Write',
  'Bash',
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
];

/**
 * When Settings → Agents → Claude → Chrome is on, Sideboard passes `--chrome`
 * and auto-approves the Claude-in-Chrome MCP + skill (otherwise browser actions
 * prompt and fail headlessly).
 */
export const CLAUDE_CHROME_ALLOWED_TOOLS = [
  'mcp__claude-in-chrome',
  'mcp__claude-in-chrome__*',
  'Skill(claude-in-chrome)',
] as const;

/** macOS ARG_MAX ~256KiB — keep `-p` prompt args under this (stdin for larger). */
export const CLAUDE_PROMPT_ARG_MAX = 200_000;

async function loadMcpServers() {
  // `--json` is unsupported on current Claude CLI builds; always use text list.
  const claude = resolveClaudeExecutable();
  const mcpText = await run(claude, ['mcp', 'list'], { reject: false });
  return parseMcpList(`${mcpText.stdout}\n${mcpText.stderr}`);
}

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function usageFromClaude(usage: ClaudeUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  if (!inputTokens && !outputTokens) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cache_read_input_tokens ? Number(usage.cache_read_input_tokens) : undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens
      ? Number(usage.cache_creation_input_tokens)
      : undefined,
  };
}

/** Pull a human-readable error out of a Claude stream-json `result` event. */
export function claudeResultErrorDetail(obj: Record<string, unknown>): string | null {
  const isError =
    Boolean(obj.is_error) ||
    (typeof obj.subtype === 'string' && /^error/i.test(obj.subtype));

  const fromResult = typeof obj.result === 'string' ? obj.result.trim() : '';
  // Session/weekly limits often arrive as normal result text (no is_error), then exit 1.
  if (fromResult && (isError || looksLikeAgentFailureMessage(fromResult))) {
    return fromResult;
  }
  if (!isError) return null;

  const errors = obj.errors;
  if (Array.isArray(errors)) {
    const parts = errors
      .map((e) => {
        if (typeof e === 'string') return e.trim();
        if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
          return (e as { message: string }).message.trim();
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }

  if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
  if (typeof obj.subtype === 'string' && obj.subtype) {
    return obj.subtype.replace(/^error[_-]?/i, '').replace(/_/g, ' ') || 'Claude turn failed';
  }
  return 'Claude turn failed';
}

function eventsFromContentBlocks(blocks: ContentBlock[] | undefined): AgentEvent[] {
  if (!blocks?.length) return [];
  const out: AgentEvent[] = [];
  for (const block of blocks) {
    if (!block?.type) continue;
    if (block.type === 'text' && block.text) {
      out.push({ type: 'stdout', data: block.text });
      continue;
    }
    if ((block.type === 'thinking' || block.type === 'redacted_thinking') && block.thinking) {
      out.push({ type: 'thinking', data: block.thinking });
      continue;
    }
    if (block.type === 'tool_use' && block.id && block.name) {
      out.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      });
      continue;
    }
    if (block.type === 'tool_result' && block.tool_use_id) {
      const content =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .map((c) =>
                  typeof c === 'string'
                    ? c
                    : c && typeof c === 'object' && 'text' in c
                      ? String((c as { text?: string }).text ?? '')
                      : '',
                )
                .join('')
            : block.content != null
              ? JSON.stringify(block.content)
              : undefined;
      out.push({
        type: 'tool_result',
        id: block.tool_use_id,
        content,
        isError: Boolean(block.is_error),
      });
    }
  }
  return out;
}

export const claudeAdapter: AgentAdapter = {
  kind: 'claude',

  async detect(): Promise<AgentStatus> {
    const claude = resolveClaudeExecutable();
    if (claude !== 'claude') {
      if (!existsSync(claude)) {
        return {
          agent: 'claude',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: `Claude Code executable not found: ${claude}`,
        };
      }
    } else {
      const which = await run('which', ['claude'], { reject: false });
      if (which.exitCode !== 0) {
        return {
          agent: 'claude',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: 'claude CLI not found on PATH',
        };
      }
    }

    const auth = await run(claude, ['auth', 'status'], {
      reject: false,
      timeoutMs: 5_000,
    });
    const authenticated = auth.exitCode === 0;

    // Do not spawn `claude mcp list` during detect — nested under an active
    // Claude/Codex turn (MCP create_thread → requireAgent) it can block forever.
    // Ticket sources use Sideboard Account integrations, not agent Linear MCP.
    return {
      agent: 'claude',
      installed: true,
      authenticated,
      linearMcp: false,
      warnings: [],
      reason: authenticated
        ? undefined
        : 'claude auth status failed — run `claude auth login`',
    };
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    const claude = resolveClaudeExecutable();
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    // Resumed sessions already carry history via --resume; a prefix here only
    // bloats the user message and can push Claude Code past 4 cache breakpoints.
    const effective = dropCachedPrefixOnResume(input, sessionId);
    const promptText = flattenTurnInput(effective);
    const useStdin = promptText.length > CLAUDE_PROMPT_ARG_MAX;

    if (process.env.SIDEBOARD_DEBUG_CLAUDE_TURN === '1') {
      console.error(
        `[sideboard/claude] promptChars=${promptText.length} resumed=${Boolean(sessionId)} stdin=${useStdin}`,
      );
    }

    const mode = permissionMode(thread);
    const { isOrchestratorThread } = await import('../store/global-workspace.js');
    const isOrchestrator = isOrchestratorThread(thread);
    // Sideboard MCP always (worktrees: present_*; coordinators: full fleet).
    // Brightsy MCP only when logged in and the user asked (or this thread used it).
    const injectedServers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: shouldInjectBrightsyMcp(thread, {
        orchestrator: isOrchestrator,
      }),
      orchestratorThreadId: isOrchestrator ? thread.id : null,
    });
    const injectedBrightsyNames = injectedServers
      .filter((s) => s.name === 'brightsy' || s.name.startsWith('brightsy_'))
      .map((s) => s.name);
    // Orchestrators keep Bash/Read/etc (inspect child worktrees by absolute path)
    // plus Sideboard MCP for fleet control. Identity prompts forbid treating the
    // synthetic global cwd as a project worktree.
    const chromeOn = claudeChromeEnabled();
    let allowedTools: string[];
    if (isOrchestrator) {
      allowedTools = [
        ...BASE_ALLOWED_TOOLS,
        ...SIDEBOARD_MCP_ALLOWED_TOOLS,
        ...brightsyMcpAllowedTools(injectedBrightsyNames),
      ];
    } else {
      // Only Linear was previously allowed, so other Connected MCP servers (Brightsy,
      // Gmail, …) looked "not logged in" when Claude hit a permission denial.
      const servers = await loadMcpServers();
      allowedTools = [
        ...BASE_ALLOWED_TOOLS,
        ...mcpAllowTools(servers),
        ...SIDEBOARD_ARTIFACT_MCP_ALLOWED_TOOLS,
        ...brightsyMcpAllowedTools(injectedBrightsyNames),
      ];
    }
    if (chromeOn) {
      allowedTools = [...allowedTools, ...CLAUDE_CHROME_ALLOWED_TOOLS];
    }
    // Plain-text `-p` prompt (not --input-format stream-json). Structured stream-json
    // user messages are merged into the API request where Claude Code already applies
    // cache_control on system + tools + messages (max 4). stream-json input was the
    // root cause of "Found 5" even after Sideboard stopped attaching cache_control.
    const args = [
      '-p',
      ...(useStdin ? [] : [promptText]),
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      mode.claude,
    ];
    const mcpConfigPath = writeMcpServersConfig(injectedServers);
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }
    if (chromeOn) {
      args.push('--chrome');
    }
    if (useStdin) {
      args.push('--input-format', 'text');
    }
    for (const tool of allowedTools) {
      args.push('--allowedTools', tool);
    }
    if (thread.model) {
      args.push('--model', thread.model);
    }
    const effort =
      thread.effort ?? (thread.fast ? ('low' as const) : ('high' as const));
    args.push('--effort', effort);
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    return {
      file: claude,
      args,
      cwd: thread.worktreePath,
      stdin: useStdin ? `${promptText}\n` : undefined,
    };
  },

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // Nearly every Claude stream-json event includes session_id — only treat
      // init (and explicit system session markers) as session events. Returning
      // early on any session_id drops assistant/result text.
      if (obj.type === 'system' && obj.subtype === 'init') {
        const sid = (obj as { session_id?: string }).session_id;
        if (typeof sid === 'string') return { type: 'session_id', data: sid };
        return null;
      }
      if (obj.type === 'system' && typeof (obj as { session_id?: string }).session_id === 'string') {
        return { type: 'session_id', data: (obj as { session_id: string }).session_id };
      }

      if (obj.type === 'assistant' || obj.type === 'user') {
        const content = (obj as { message?: { content?: ContentBlock[] } }).message?.content;
        const events = eventsFromContentBlocks(content);
        // For assistant snapshots after streaming, prefer tool/thinking blocks;
        // text may duplicate stream deltas (spawn dedupes stdout).
        if (events.length === 0) return null;
        return events.length === 1 ? events[0]! : events;
      }

      // Token streaming from --include-partial-messages
      if (obj.type === 'stream_event') {
        const event = (
          obj as {
            event?: {
              type?: string;
              delta?: {
                type?: string;
                text?: string;
                thinking?: string;
                partial_json?: string;
              };
              content_block?: ContentBlock;
            };
          }
        ).event;
        if (!event) return null;
        if (event.type === 'content_block_start' && event.content_block) {
          const block = event.content_block;
          if (block.type === 'tool_use' && block.id && block.name) {
            return {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }
          if (block.type === 'thinking' && block.thinking) {
            return { type: 'thinking', data: block.thinking };
          }
          return null;
        }
        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.text) return { type: 'stdout', data: event.delta.text };
          if (event.delta.thinking) return { type: 'thinking', data: event.delta.thinking };
          return null;
        }
        return null;
      }

      if (obj.type === 'content_block_delta') {
        const delta = (obj as { delta?: { text?: string; thinking?: string } }).delta;
        if (delta?.text) return { type: 'stdout', data: delta.text };
        if (delta?.thinking) return { type: 'thinking', data: delta.thinking };
        return null;
      }

      // Final result mirrors assistant text; spawn dedupes when both appear. It also
      // carries the turn's total usage (aggregated across every API call Claude made).
      // Error results (credits, limits, API failures, …) must land on stderr so
      // lastError isn't just a bare "exit 1".
      if (obj.type === 'result') {
        const events: AgentEvent[] = [];
        const errorDetail = claudeResultErrorDetail(obj);
        if (errorDetail) {
          events.push({ type: 'stderr', data: errorDetail });
        } else {
          const text = (obj as { result?: unknown }).result;
          if (typeof text === 'string' && text) events.push({ type: 'stdout', data: text });
        }
        const usage = usageFromClaude((obj as { usage?: ClaudeUsage }).usage);
        if (usage) events.push({ type: 'usage', data: usage });
        if (events.length === 0) return null;
        return events.length === 1 ? events[0]! : events;
      }

      return null;
    } catch {
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    // Prefer cached id; Claude's --continue is cwd-scoped but we always pass
    // an explicit --resume when we have one. Fresh sessions get their id from
    // the stream-json init event.
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const claude = resolveClaudeExecutable();
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const args = sessionId ? ['--resume', sessionId] : [];
    if (claudeChromeEnabled()) {
      args.push('--chrome');
    }
    return { file: claude, args, cwd: thread.worktreePath };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const claude = resolveClaudeExecutable();
    const prompt =
      'List my assigned Linear issues as JSON array only, no markdown. Each item: id, identifier, title, url, labels (string[]).';
    const { stdout, exitCode } = await run(
      claude,
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--permission-mode',
        'bypassPermissions',
        '--allowedTools',
        'mcp__linear__*',
      ],
      { reject: false },
    );
    if (exitCode !== 0) return [];
    return parseIssuesJson(stdout);
  },
};

function parseIssuesJson(raw: string): IssueInfo[] {
  const text = raw.trim();
  // Try whole string, then extract first [...] block
  const candidates = [text];
  const match = text.match(/\[[\s\S]*\]/);
  if (match) candidates.push(match[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          id: String(item.id ?? item.identifier ?? ''),
          identifier: String(item.identifier ?? item.id ?? ''),
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          labels: Array.isArray(item.labels)
            ? item.labels.map(String)
            : [],
        }));
      }
      // Claude --output-format json wraps result
      if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') {
        return parseIssuesJson(parsed.result);
      }
    } catch {
      // continue
    }
  }
  return [];
}
