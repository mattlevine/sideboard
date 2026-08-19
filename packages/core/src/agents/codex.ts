import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import { resolveAgentExecutable } from '../store/app-settings.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage } from './error-detail.js';
import { fromInclusiveInputUsage } from './usage.js';
import { codexUnattendedGitConfigArgs, resolveCodexGitWritableRoots } from '../git/git-auth-mode.js';
import {
  buildInjectedMcpServers,
  shouldInjectBrightsyMcp,
  toCodexMcpConfigArgs,
} from './injected-mcp.js';
import type { AgentModelInfo } from './model-info.js';
import { flattenTurnInput, dropCachedPrefixOnResume } from './turn-input.js';
import { permissionMode } from './types.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

/** macOS ARG_MAX ~256KiB — use `codex exec -` + stdin for larger prompts. */
export const CODEX_PROMPT_ARG_MAX = 200_000;

const FALLBACK_CODEX_MODELS: AgentModelInfo[] = [
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', displayName: 'GPT-5.5' },
  { id: 'gpt-5.2', displayName: 'GPT-5.2' },
];

let cachedCodexModels: { at: number; models: AgentModelInfo[] } | null = null;
const CODEX_MODEL_CACHE_MS = 5 * 60 * 1000;

/**
 * Models from `codex debug models` (JSON catalog). Prefers visibility=list.
 * Falls back to a small static list when Codex isn't installed / command fails.
 */
export async function listCodexModels(): Promise<AgentModelInfo[]> {
  const now = Date.now();
  if (cachedCodexModels && now - cachedCodexModels.at < CODEX_MODEL_CACHE_MS) {
    return cachedCodexModels.models;
  }

  const codex = resolveAgentExecutable('codex');
  if (codex === 'codex') {
    const which = await run('which', ['codex'], { reject: false });
    if (which.exitCode !== 0) return FALLBACK_CODEX_MODELS;
  } else if (!existsSync(codex)) {
    return FALLBACK_CODEX_MODELS;
  }

  const listed = await run(codex, ['debug', 'models'], { reject: false });
  if (listed.exitCode !== 0 || !listed.stdout.trim()) {
    return cachedCodexModels?.models ?? FALLBACK_CODEX_MODELS;
  }

  try {
    const parsed = JSON.parse(listed.stdout) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        description?: string;
        visibility?: string;
        priority?: number;
      }>;
    };
    const rows = Array.isArray(parsed.models) ? parsed.models : [];
    const preferred = rows.filter((m) => (m.visibility ?? 'list') === 'list');
    const source = preferred.length > 0 ? preferred : rows;
    const models = source
      .map((m) => ({
        id: (m.slug || '').trim(),
        displayName: (m.display_name || m.slug || '').trim(),
        description: m.description,
        priority: typeof m.priority === 'number' ? m.priority : 999,
      }))
      .filter((m) => m.id)
      .sort((a, b) => a.priority - b.priority)
      .map(({ id, displayName, description }) => ({ id, displayName, description }));
    if (models.length === 0) return FALLBACK_CODEX_MODELS;
    cachedCodexModels = { at: now, models };
    return models;
  } catch {
    return cachedCodexModels?.models ?? FALLBACK_CODEX_MODELS;
  }
}

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

function usageFromCodex(usage: CodexUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  // `reasoning_output_tokens` is a subset of `output_tokens` — do not add it.
  return fromInclusiveInputUsage({
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cachedInputTokens: Number(usage.cached_input_tokens ?? 0),
  });
}

function codexConfigHasNetworkAccess(): boolean {
  const candidates = [
    join(homedir(), '.codex', 'config.toml'),
    join(homedir(), '.config', 'codex', 'config.toml'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (/network_access\s*=\s*true/.test(text)) return true;
  }
  return false;
}

/** Flatten Codex/MCP result content arrays to a single string payload. */
function unwrapCodexMcpResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return String(result);
  const rec = result as Record<string, unknown>;
  if (Array.isArray(rec.content)) {
    const texts: string[] = [];
    for (const item of rec.content) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text === 'string') texts.push(text);
    }
    if (texts.length) return texts.join('\n');
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function codexLooksAuthenticated(): boolean {
  // Never spawn `codex login status` / `codex mcp list` from detect — nested under
  // an active `codex exec` those CLIs can block forever on ~/.codex SQLite locks,
  // which hangs Sideboard MCP create_thread (orchestrator → create agent=codex).
  const authPath = join(homedir(), '.codex', 'auth.json');
  if (!existsSync(authPath)) return false;
  try {
    return statSync(authPath).size > 2;
  } catch {
    return false;
  }
}

export const codexAdapter: AgentAdapter = {
  kind: 'codex',

  async detect(): Promise<AgentStatus> {
    const codex = resolveAgentExecutable('codex');
    if (codex !== 'codex') {
      if (!existsSync(codex)) {
        return {
          agent: 'codex',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: `Codex executable not found: ${codex}`,
        };
      }
    } else {
      const which = await run('which', ['codex'], { reject: false, timeoutMs: 3_000 });
      if (which.exitCode !== 0) {
        return {
          agent: 'codex',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: 'codex CLI not found on PATH',
        };
      }
    }

    const authenticated = codexLooksAuthenticated();
    const linearMcp = false;

    const warnings: string[] = [];
    if (!codexConfigHasNetworkAccess()) {
      warnings.push(
        'Codex workspace-write blocks network by default — set [sandbox_workspace_write] network_access = true in ~/.codex/config.toml if agents need npm install etc.',
      );
    }

    return {
      agent: 'codex',
      installed: true,
      authenticated,
      linearMcp,
      warnings,
      reason: authenticated
        ? undefined
        : 'Codex auth not found — run `codex login` (expected ~/.codex/auth.json)',
    };
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    // Codex CLI cannot emit OpenAI `prompt_cache_breakpoint` / cache_control
    // (see openai/codex#35300). Keep a stable prefix-first string so implicit
    // prompt caching can still match across turns / resume. Plain text only —
    // no structured stdin / stream-json input that could add extra breakpoints.
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const prompt = flattenTurnInput(dropCachedPrefixOnResume(input, sessionId));
    const useStdin = prompt.length > CODEX_PROMPT_ARG_MAX;
    // `-` reads the full prompt from stdin; spawn closes the pipe immediately
    // (avoids codex exec hanging on an open empty stdin — see openai/codex#20919).
    const promptArg = useStdin ? '-' : prompt;

    if (process.env.SIDEBOARD_DEBUG_CODEX_TURN === '1') {
      console.error(
        `[sideboard/codex] promptChars=${prompt.length} resumed=${Boolean(sessionId)} stdin=${useStdin} hasPrefix=${prompt.includes('Current request:')}`,
      );
    }

    const mode = permissionMode(thread);
    const model = thread.model?.trim();
    const isOrchestrator = isOrchestratorThread(thread);
    const injected = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: shouldInjectBrightsyMcp(thread, {
        orchestrator: isOrchestrator,
      }),
      orchestratorThreadId: isOrchestrator ? thread.id : null,
    });
    const mcpOverrides = toCodexMcpConfigArgs(injected);
    // Options must come before the prompt / `resume` subcommand. `codex exec resume`
    // does not accept `--cd` / `--sandbox` after SESSION_ID PROMPT (Codex ≥0.147).
    const execOpts = [
      // Global orchestration cwd is not a git repo; without this Codex ≥0.147
      // refuses to start ("Not inside a trusted directory").
      '--skip-git-repo-check',
      '--cd',
      thread.worktreePath,
      '--json',
      '--sandbox',
      mode.codexSandbox,
      // `codex exec` rejects `--ask-for-approval` (global-only on newer CLIs).
      '-c',
      'approval_policy="never"',
      // Seatbelt cannot use the login Keychain; inherit GH_CONFIG_DIR / GIT_CONFIG_*.
      // Default policy also strips *TOKEN*. Linked worktrees need the main
      // repo `.git` (+ `.git/worktrees/<name>`) as writable_roots so git commit
      // can create index.lock.
      ...codexUnattendedGitConfigArgs(mode.codexSandbox, {
        writableRoots:
          mode.codexSandbox === 'workspace-write'
            ? await resolveCodexGitWritableRoots(thread.worktreePath)
            : [],
      }),
      ...(model ? (['--model', model] as const) : []),
      ...mcpOverrides,
    ];
    const args = sessionId
      ? ['exec', ...execOpts, 'resume', sessionId, promptArg]
      : ['exec', ...execOpts, promptArg];

    return {
      file: resolveAgentExecutable('codex'),
      args,
      cwd: thread.worktreePath,
      stdin: useStdin ? `${prompt}\n` : undefined,
    };
  },

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const type = typeof obj.type === 'string' ? obj.type : '';

      // Failures first — never let session_id short-circuit an error event.
      if (type === 'turn.failed' || type === 'turn_failed') {
        const detail =
          extractJsonErrorMessage(obj) ||
          extractJsonErrorMessage((obj.error as Record<string, unknown>) ?? {}) ||
          'Codex turn failed';
        return { type: 'stderr', data: detail };
      }
      if (type === 'error') {
        const detail = extractJsonErrorMessage(obj) || trimmed;
        // Non-fatal reconnect notices — ignore for lastError / chat noise.
        if (/^reconnecting\.\.\./i.test(detail)) return null;
        return { type: 'stderr', data: detail };
      }
      if (typeof obj.item === 'object' && obj.item !== null) {
        const item = obj.item as {
          id?: string;
          type?: string;
          item_type?: string;
          text?: string;
          message?: string;
          status?: string;
          server?: string;
          tool?: string;
          arguments?: unknown;
          result?: unknown;
          error?: { message?: string } | null;
          command?: string;
          aggregated_output?: string;
        };
        const itemType = item.type ?? item.item_type;

        if (itemType === 'error') {
          const detail = item.message?.trim() || extractJsonErrorMessage(obj) || 'Codex item error';
          // Stream-lag warnings are non-fatal; still surface but prefer real failures later.
          return { type: 'stderr', data: detail };
        }
        if (itemType === 'agent_message' && item.text) {
          return { type: 'stdout', data: item.text };
        }
        if (itemType === 'mcp_tool_call' && item.id && item.server && item.tool) {
          const name = `mcp__${item.server}__${item.tool}`;
          const input = asRecord(item.arguments);
          const events: AgentEvent[] = [
            { type: 'tool_use', id: item.id, name, input },
          ];
          const finished =
            type === 'item.completed' ||
            item.status === 'completed' ||
            item.status === 'failed';
          if (finished) {
            const errMsg =
              item.error && typeof item.error.message === 'string'
                ? item.error.message
                : undefined;
            events.push({
              type: 'tool_result',
              id: item.id,
              content: unwrapCodexMcpResult(item.result) ?? errMsg,
              isError: item.status === 'failed' || Boolean(errMsg),
            });
          }
          return events.length === 1 ? events[0]! : events;
        }
        if (itemType === 'command_execution' && item.id) {
          const input = item.command ? { command: item.command } : undefined;
          const events: AgentEvent[] = [
            { type: 'tool_use', id: item.id, name: 'Bash', input },
          ];
          if (
            type === 'item.completed' ||
            item.status === 'completed' ||
            item.status === 'failed'
          ) {
            events.push({
              type: 'tool_result',
              id: item.id,
              content: item.aggregated_output,
              isError: item.status === 'failed',
            });
          }
          return events.length === 1 ? events[0]! : events;
        }
        if (item.status === 'failed') {
          const detail =
            item.message?.trim() ||
            extractJsonErrorMessage(item as Record<string, unknown>) ||
            `Codex ${itemType ?? 'item'} failed`;
          return { type: 'stderr', data: detail };
        }
      }

      const sid =
        (typeof obj.session_id === 'string' && obj.session_id) ||
        (typeof obj.thread_id === 'string' && obj.thread_id) ||
        (typeof (obj as { session?: { id?: string } }).session?.id === 'string' &&
          (obj as { session: { id: string } }).session.id);
      if (sid && (type === 'thread.started' || type === 'session' || !type)) {
        return { type: 'session_id', data: sid };
      }
      if (sid && type.endsWith('.started')) {
        return { type: 'session_id', data: sid };
      }

      if (type === 'turn.completed' || type === 'turn_completed') {
        const usage = usageFromCodex((obj as { usage?: CodexUsage }).usage);
        return usage ? { type: 'usage', data: usage, scope: 'turn' } : null;
      }

      if (typeof obj.content === 'string' && obj.content.trim()) {
        return { type: 'stdout', data: obj.content };
      }
      // Avoid dumping unknown JSON blobs into the chat / lastError path.
      return null;
    } catch {
      // Plain stderr-ish lines from the CLI (non-JSON).
      if (/error|failed|unauthorized|quota|limit/i.test(trimmed)) {
        return { type: 'stderr', data: trimmed };
      }
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const codex = resolveAgentExecutable('codex');
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (sessionId) {
      return {
        file: codex,
        args: ['exec', '--cd', thread.worktreePath, 'resume', sessionId],
        cwd: thread.worktreePath,
      };
    }
    return {
      file: codex,
      args: ['--cd', thread.worktreePath],
      cwd: thread.worktreePath,
    };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only: id, identifier, title, url, labels.';
    const { stdout, exitCode } = await run(
      resolveAgentExecutable('codex'),
      [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '-c',
        'approval_policy="never"',
        prompt,
      ],
      { reject: false },
    );
    if (exitCode !== 0) return [];
    const match = stdout.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]) as IssueInfo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
};
