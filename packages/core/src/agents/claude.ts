import { existsSync } from 'node:fs';
import { run } from '../git/run.js';
import {
  claudeChromeEnabled,
  resolveClaudeExecutable,
} from '../store/app-settings.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { mcpAllowTools, parseMcpList } from './claude-mcp.js';
import { looksLikeAgentFailureMessage } from './error-detail.js';
import { withEventParentId } from './message-parts.js';
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
 *
 * Background Agent/Task polls (`run_in_background`) need TaskOutput / TaskStop
 * or the parent cannot wait and those children look lost. EnterWorktree is how
 * `isolation: "worktree"` agents actually start. Skill is process guides.
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
  // Subagents (Claude Code v2.1.63 renamed Task → Agent; allow both).
  'Task',
  'Agent',
  'TaskOutput',
  'TaskStop',
  'EnterWorktree',
  'ExitWorktree',
  'Skill',
];

/**
 * `claude -p` waits this long for background Agent/Task before abandoning them.
 * Claude Code’s default is 10 minutes — too short for a coding subagent, so
 * Sideboard raises it unless the user already set the env.
 */
export const CLAUDE_PRINT_BG_WAIT_CEILING_MS = 7_200_000;

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
  // Anthropic: input_tokens is uncached; cache_read / cache_creation are extra.
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const cacheReadTokens = Number(usage.cache_read_input_tokens ?? 0);
  const cacheWriteTokens = Number(usage.cache_creation_input_tokens ?? 0);
  if (!inputTokens && !outputTokens && !cacheReadTokens && !cacheWriteTokens) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens || undefined,
    cacheWriteTokens: cacheWriteTokens || undefined,
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

function eventsFromContentBlocks(
  blocks: ContentBlock[] | undefined,
  parentId?: string,
): AgentEvent[] {
  if (!blocks?.length) return [];
  const out: AgentEvent[] = [];
  for (const block of blocks) {
    if (!block?.type) continue;
    if (block.type === 'text' && block.text) {
      out.push(withEventParentId({ type: 'stdout', data: block.text }, parentId));
      continue;
    }
    if ((block.type === 'thinking' || block.type === 'redacted_thinking') && block.thinking) {
      out.push(withEventParentId({ type: 'thinking', data: block.thinking }, parentId));
      continue;
    }
    if (block.type === 'tool_use' && block.id && block.name) {
      out.push(
        withEventParentId(
          {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          },
          parentId,
        ),
      );
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
      out.push(
        withEventParentId(
          {
            type: 'tool_result',
            id: block.tool_use_id,
            content,
            isError: Boolean(block.is_error),
          },
          parentId,
        ),
      );
    }
  }
  return out;
}

function claudeParentToolUseId(obj: Record<string, unknown>): string | undefined {
  const nested =
    obj.event && typeof obj.event === 'object' && !Array.isArray(obj.event)
      ? (obj.event as Record<string, unknown>)
      : undefined;
  for (const id of [obj.parent_tool_use_id, nested?.parent_tool_use_id]) {
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return undefined;
}

function claudeString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Background Agent/Task progress lives on `system/task_*` (and API retries on
 * `system/api_retry`). Every Claude system event also carries session_id — if
 * we treat that as the parent session, those events vanish and a nested
 * `system/init` steals `--resume` for the next turn.
 */
function eventsFromClaudeSystem(obj: Record<string, unknown>): AgentEvent | AgentEvent[] | null {
  const subtype = claudeString(obj, 'subtype') ?? '';
  const parentId = claudeParentToolUseId(obj);

  if (subtype === 'init') {
    if (parentId) return null;
    const sid = claudeString(obj, 'session_id');
    return sid ? { type: 'session_id', data: sid } : null;
  }

  if (subtype === 'task_started') {
    const id =
      claudeString(obj, 'tool_use_id') ?? claudeString(obj, 'task_id');
    if (!id) return null;
    const description = claudeString(obj, 'description');
    const taskType = claudeString(obj, 'task_type');
    const prompt = claudeString(obj, 'prompt');
    return withEventParentId(
      {
        type: 'tool_use',
        id,
        name: taskType || 'Agent',
        input: {
          ...(description ? { description } : {}),
          ...(prompt ? { prompt } : {}),
          ...(claudeString(obj, 'task_id') ? { task_id: claudeString(obj, 'task_id') } : {}),
        },
      },
      parentId,
    );
  }

  if (subtype === 'task_notification') {
    const id =
      claudeString(obj, 'tool_use_id') ?? claudeString(obj, 'task_id') ?? parentId;
    if (!id) return null;
    const status = claudeString(obj, 'status') ?? 'working';
    const tools = typeof obj.tool_uses === 'number' ? obj.tool_uses : undefined;
    const durationMs = typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined;
    const lastTool =
      claudeString(obj, 'last_tool') ??
      claudeString(obj, 'current_tool') ??
      claudeString(obj, 'tool');
    const snapshot = [
      status,
      tools != null ? `${tools} tools` : null,
      durationMs != null ? `${Math.round(durationMs / 1000)}s` : null,
      lastTool,
    ]
      .filter((bit): bit is string => Boolean(bit))
      .join(' · ');
    return [
      {
        type: 'tool_use',
        id,
        name: claudeString(obj, 'task_type') || 'Agent',
        input: {
          live_status: status,
          ...(tools != null ? { live_tool_uses: tools } : {}),
          ...(durationMs != null ? { live_duration_ms: durationMs } : {}),
          ...(lastTool ? { live_last_tool: lastTool } : {}),
        },
      },
      withEventParentId(
        { type: 'thinking', data: snapshot, replace: true },
        id,
      ),
    ];
  }

  if (subtype === 'api_retry') {
    const attempt = obj.attempt;
    const max = obj.max_retries;
    const delay = obj.retry_delay_ms;
    return {
      type: 'thinking',
      data: `API retry ${attempt ?? '?'}/${max ?? '?'}${
        typeof delay === 'number' ? ` (wait ${delay}ms)` : ''
      }`,
    };
  }

  return null;
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
      // Nested Task/Agent thinking+text in stream-json (Claude Code 2.1.211+).
      // Raise the -p background-agent wait so long TaskOutput polls are not
      // abandoned at Claude Code’s 10-minute default.
      env: {
        CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: '1',
        CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS:
          process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ??
          String(CLAUDE_PRINT_BG_WAIT_CEILING_MS),
      },
    };
  },

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // Nearly every Claude stream-json event includes session_id — only treat
      // top-level system/init as a session event. Returning early on any
      // session_id drops assistant/result text, task_started / task_notification
      // (background Agent polls), and nested inits that would steal --resume.
      if (obj.type === 'system') {
        return eventsFromClaudeSystem(obj);
      }

      if (obj.type === 'assistant' || obj.type === 'user') {
        const parentId = claudeParentToolUseId(obj);
        const message = (obj as { message?: { content?: ContentBlock[]; usage?: ClaudeUsage } })
          .message;
        const events = eventsFromContentBlocks(message?.content, parentId);
        if (obj.type === 'assistant') {
          const usage = usageFromClaude(message?.usage);
          if (usage) events.push({ type: 'usage', data: usage, scope: 'request' });
        }
        // For assistant snapshots after streaming, prefer tool/thinking blocks;
        // text may duplicate stream deltas (spawn dedupes stdout).
        if (events.length === 0) return null;
        return events.length === 1 ? events[0]! : events;
      }

      // Token streaming from --include-partial-messages
      if (obj.type === 'stream_event') {
        const parentId = claudeParentToolUseId(obj);
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
            return withEventParentId(
              {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              },
              parentId,
            );
          }
          if (block.type === 'thinking' && block.thinking) {
            return withEventParentId({ type: 'thinking', data: block.thinking }, parentId);
          }
          return null;
        }
        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.text) {
            return withEventParentId({ type: 'stdout', data: event.delta.text }, parentId);
          }
          if (event.delta.thinking) {
            return withEventParentId({ type: 'thinking', data: event.delta.thinking }, parentId);
          }
          return null;
        }
        return null;
      }

      if (obj.type === 'content_block_delta') {
        const parentId = claudeParentToolUseId(obj);
        const delta = (obj as { delta?: { text?: string; thinking?: string } }).delta;
        if (delta?.text) return withEventParentId({ type: 'stdout', data: delta.text }, parentId);
        if (delta?.thinking) {
          return withEventParentId({ type: 'thinking', data: delta.thinking }, parentId);
        }
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
        if (usage) {
          const totalCost = (obj as { total_cost_usd?: unknown }).total_cost_usd;
          if (totalCost != null && Number.isFinite(Number(totalCost))) {
            usage.costUsd = Number(totalCost);
          }
          events.push({ type: 'usage', data: usage, scope: 'turn' });
        }
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
