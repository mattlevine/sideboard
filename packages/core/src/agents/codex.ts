import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage } from './error-detail.js';
import type { AgentModelInfo } from './model-info.js';
import { flattenTurnInput, normalizeTurnInput } from './turn-input.js';
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

  const which = await run('which', ['codex'], { reject: false });
  if (which.exitCode !== 0) return FALLBACK_CODEX_MODELS;

  const listed = await run('codex', ['debug', 'models'], { reject: false });
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
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0) + Number(usage.reasoning_output_tokens ?? 0);
  if (!inputTokens && !outputTokens) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cached_input_tokens ? Number(usage.cached_input_tokens) : undefined,
  };
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

export const codexAdapter: AgentAdapter = {
  kind: 'codex',

  async detect(): Promise<AgentStatus> {
    const which = await run('which', ['codex'], { reject: false });
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

    const auth = await run('codex', ['login', 'status'], { reject: false });
    const authenticated = auth.exitCode === 0;

    const mcp = await run('codex', ['mcp', 'list', '--json'], { reject: false });
    const linearMcp = /linear/i.test(mcp.stdout + mcp.stderr);

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
      reason: authenticated ? undefined : 'codex login status failed — run `codex login`',
    };
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    // Codex CLI cannot emit OpenAI `prompt_cache_breakpoint` / cache_control
    // (see openai/codex#35300). Keep a stable prefix-first string so implicit
    // prompt caching can still match across turns / resume. Plain text only —
    // no structured stdin / stream-json input that could add extra breakpoints.
    const prompt = flattenTurnInput(input);
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const useStdin = prompt.length > CODEX_PROMPT_ARG_MAX;
    // `-` reads the full prompt from stdin; spawn closes the pipe immediately
    // (avoids codex exec hanging on an open empty stdin — see openai/codex#20919).
    const promptArg = useStdin ? '-' : prompt;

    if (process.env.SIDEBOARD_DEBUG_CODEX_TURN === '1') {
      const { cachedPrefix } = normalizeTurnInput(input);
      console.error(
        `[sideboard/codex] promptChars=${prompt.length} resumed=${Boolean(sessionId)} stdin=${useStdin} hasPrefix=${Boolean(cachedPrefix)}`,
      );
    }

    const mode = permissionMode(thread);
    const model = thread.model?.trim();
    const args = [
      'exec',
      ...(sessionId ? (['resume', sessionId] as const) : []),
      promptArg,
      '--cd',
      thread.worktreePath,
      '--json',
      '--sandbox',
      mode.codexSandbox,
      '--ask-for-approval',
      'never',
      ...(model ? (['--model', model] as const) : []),
    ];

    return {
      file: 'codex',
      args,
      cwd: thread.worktreePath,
      stdin: useStdin ? `${prompt}\n` : undefined,
    };
  },

  parseEvent(line: string): AgentEvent | null {
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
          type?: string;
          text?: string;
          message?: string;
          status?: string;
        };
        if (item.type === 'error') {
          const detail = item.message?.trim() || extractJsonErrorMessage(obj) || 'Codex item error';
          // Stream-lag warnings are non-fatal; still surface but prefer real failures later.
          return { type: 'stderr', data: detail };
        }
        if (item.type === 'agent_message' && item.text) {
          return { type: 'stdout', data: item.text };
        }
        if (item.status === 'failed') {
          const detail =
            item.message?.trim() ||
            extractJsonErrorMessage(item as Record<string, unknown>) ||
            `Codex ${item.type ?? 'item'} failed`;
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
        return usage ? { type: 'usage', data: usage } : null;
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
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (sessionId) {
      return {
        file: 'codex',
        args: ['exec', 'resume', sessionId, '--cd', thread.worktreePath],
        cwd: thread.worktreePath,
      };
    }
    return {
      file: 'codex',
      args: ['--cd', thread.worktreePath],
      cwd: thread.worktreePath,
    };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only: id, identifier, title, url, labels.';
    const { stdout, exitCode } = await run(
      'codex',
      [
        'exec',
        prompt,
        '--json',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
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
