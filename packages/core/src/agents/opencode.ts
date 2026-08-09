import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage, formatUnknownDetail } from './error-detail.js';
import {
  buildInjectedMcpServers,
  isBrightsyConnected,
  toOpencodeMcpConfigContent,
} from './injected-mcp.js';
import type { AgentModelInfo } from './model-info.js';
import { flattenTurnInput } from './turn-input.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';
import { permissionMode } from './types.js';

const FALLBACK_OPENCODE_MODELS: AgentModelInfo[] = [
  { id: 'opencode/big-pickle', displayName: 'opencode · big-pickle' },
  {
    id: 'openrouter/~anthropic/claude-sonnet-latest',
    displayName: 'openrouter · claude-sonnet-latest',
  },
  {
    id: 'openrouter/~openai/gpt-latest',
    displayName: 'openrouter · gpt-latest',
  },
];

let cachedOpencodeModels: { at: number; models: AgentModelInfo[] } | null = null;
const OPENCODE_MODEL_CACHE_MS = 5 * 60 * 1000;

function displayNameFromOpencodeId(id: string): string {
  const slash = id.indexOf('/');
  if (slash <= 0) return id;
  const provider = id.slice(0, slash);
  const name = id.slice(slash + 1);
  return `${provider} · ${name}`;
}

function sortOpencodeModelIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const aLatest = /latest|~/.test(a) ? 0 : 1;
    const bLatest = /latest|~/.test(b) ? 0 : 1;
    if (aLatest !== bLatest) return aLatest - bLatest;
    const aOc = a.startsWith('opencode/') ? 0 : 1;
    const bOc = b.startsWith('opencode/') ? 0 : 1;
    if (aOc !== bOc) return aOc - bOc;
    return a.localeCompare(b);
  });
}

/**
 * Models from `opencode models` (`provider/model` lines).
 * Falls back to a small static list when OpenCode isn't installed.
 */
export async function listOpencodeModels(): Promise<AgentModelInfo[]> {
  const now = Date.now();
  if (cachedOpencodeModels && now - cachedOpencodeModels.at < OPENCODE_MODEL_CACHE_MS) {
    return cachedOpencodeModels.models;
  }

  const which = await run('which', ['opencode'], { reject: false });
  if (which.exitCode !== 0) return FALLBACK_OPENCODE_MODELS;

  const listed = await run('opencode', ['models'], { reject: false });
  if (listed.exitCode !== 0 || !listed.stdout.trim()) {
    return cachedOpencodeModels?.models ?? FALLBACK_OPENCODE_MODELS;
  }

  const ids = listed.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[\w.~@+-]+\/[\w.~@+/-]+$/.test(l));
  const unique = [...new Set(ids)];
  if (unique.length === 0) return FALLBACK_OPENCODE_MODELS;

  // Full catalog can be hundreds of rows — keep a short, sorted shortlist for the picker.
  const OPENCODE_PICKER_LIMIT = 60;
  const models = sortOpencodeModelIds(unique)
    .slice(0, OPENCODE_PICKER_LIMIT)
    .map((id) => ({
      id,
      displayName: displayNameFromOpencodeId(id),
    }));
  cachedOpencodeModels = { at: now, models };
  return models;
}

type OpencodeTokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};

function usageFromOpencode(tokens: OpencodeTokens | undefined): TokenUsage | null {
  if (!tokens) return null;
  const inputTokens = Number(tokens.input ?? 0);
  const outputTokens = Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
  if (!inputTokens && !outputTokens) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: tokens.cache?.read ? Number(tokens.cache.read) : undefined,
    cacheWriteTokens: tokens.cache?.write ? Number(tokens.cache.write) : undefined,
  };
}

export const opencodeAdapter: AgentAdapter = {
  kind: 'opencode',

  async detect(): Promise<AgentStatus> {
    const which = await run('which', ['opencode'], { reject: false });
    if (which.exitCode !== 0) {
      return {
        agent: 'opencode',
        installed: false,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason: 'opencode CLI not found on PATH',
      };
    }

    const auth = await run('opencode', ['auth', 'list'], { reject: false });
    const authenticated = auth.exitCode === 0 && auth.stdout.trim().length > 0;

    const mcp = await run('opencode', ['mcp', 'list'], { reject: false });
    const linearMcp = /linear/i.test(mcp.stdout + mcp.stderr);

    return {
      agent: 'opencode',
      installed: true,
      authenticated,
      linearMcp,
      warnings: [],
      reason: authenticated
        ? undefined
        : 'opencode auth list empty — run `opencode auth login`',
    };
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    // OpenCode `run` only accepts a plain-text message (+ file attachments). There
    // is no CLI/API way for callers to set Anthropic `cache_control` breakpoints.
    // OpenCode itself injects provider cache markers in ProviderTransform.applyCaching
    // (system + last messages → cacheControl / cache_control / cachePoint) for
    // Anthropic, OpenRouter, Bedrock, etc. We keep a stable prefix-first string and
    // pipe it on stdin so large seeds avoid ARG_MAX and stay byte-identical across turns.
    const prompt = flattenTurnInput(input);
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const mode = permissionMode(thread);
    const model = thread.model?.trim();
    // Never use --continue — it's global under concurrency. Always --session <id>.
    const args = [
      'run',
      '--dir',
      thread.worktreePath,
      '--format',
      'json',
    ];
    if (sessionId) {
      args.push('--session', sessionId);
    }
    if (model) {
      args.push('--model', model);
    }
    const injected = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: isBrightsyConnected(),
    });
    const mcpContent =
      injected.length > 0 ? toOpencodeMcpConfigContent(injected) : null;
    return {
      file: 'opencode',
      args,
      cwd: thread.worktreePath,
      // `opencode run` treats non-TTY stdin as the message body when no positional
      // message is given (see resolveRunInput in opencode's run.ts).
      stdin: prompt,
      env: {
        OPENCODE_PERMISSION: mode.opencodePermission,
        ...(mcpContent ? { OPENCODE_CONFIG_CONTENT: mcpContent } : {}),
      },
    };
  },

  parseEvent(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // Failures first — never let session_id short-circuit an error event.
      if (obj.type === 'error') {
        const detail =
          extractJsonErrorMessage(obj) ||
          formatUnknownDetail(obj.error) ||
          formatUnknownDetail(obj.message) ||
          trimmed;
        return { type: 'stderr', data: detail };
      }

      const sid =
        (typeof obj.sessionID === 'string' && obj.sessionID) ||
        (typeof obj.sessionId === 'string' && obj.sessionId) ||
        (typeof obj.session_id === 'string' && obj.session_id);
      if (sid) return { type: 'session_id', data: sid };

      if (obj.type === 'text') {
        const text =
          (obj as { part?: { text?: string }; text?: string }).part?.text ??
          (obj as { text?: string }).text;
        if (text) return { type: 'stdout', data: text };
      }
      if (obj.type === 'tool_use') {
        const part = (obj as {
          part?: { id?: string; tool?: string; name?: string; input?: Record<string, unknown> };
          id?: string;
          name?: string;
          tool?: string;
          input?: Record<string, unknown>;
        }).part;
        const id = part?.id ?? (obj as { id?: string }).id ?? `tool-${Date.now()}`;
        const name =
          part?.name ?? part?.tool ?? (obj as { name?: string; tool?: string }).name ??
          (obj as { tool?: string }).tool ??
          'tool';
        const input = part?.input ?? (obj as { input?: Record<string, unknown> }).input;
        return { type: 'tool_use', id, name, input };
      }
      if (obj.type === 'tool_result') {
        const part = (obj as {
          part?: { id?: string; tool_use_id?: string; output?: string; content?: string };
          id?: string;
          tool_use_id?: string;
          output?: string;
          content?: string;
        }).part;
        const id =
          part?.tool_use_id ??
          part?.id ??
          (obj as { tool_use_id?: string; id?: string }).tool_use_id ??
          (obj as { id?: string }).id;
        if (!id) return null;
        return {
          type: 'tool_result',
          id,
          content: part?.output ?? part?.content ?? (obj as { output?: string; content?: string }).output ?? (obj as { content?: string }).content,
        };
      }
      // Usage is reported incrementally per agentic step; spawn sums these.
      if (obj.type === 'step_finish' || obj.type === 'step-finish') {
        const part = (obj as { part?: { tokens?: OpencodeTokens } }).part;
        const usage = usageFromOpencode(
          part?.tokens ?? (obj as { tokens?: OpencodeTokens }).tokens,
        );
        return usage ? { type: 'usage', data: usage } : null;
      }
      // Avoid dumping unknown JSON into the chat transcript / lastError path.
      return null;
    } catch {
      if (/error|failed|unauthorized|quota|limit/i.test(trimmed)) {
        return { type: 'stderr', data: trimmed };
      }
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(worktreePath, cached): Promise<string | null> {
    const listed = await run(
      'opencode',
      ['session', 'list', '--format', 'json'],
      { cwd: worktreePath, reject: false },
    );
    if (listed.exitCode === 0 && listed.stdout.trim()) {
      try {
        const sessions = JSON.parse(listed.stdout) as Array<{
          id?: string;
          directory?: string;
          path?: string;
          updated?: string;
        }>;
        if (Array.isArray(sessions) && sessions.length > 0) {
          const norm = (p: string) => p.replace(/\/+$/, '');
          const wt = norm(worktreePath);
          // Exact directory match only — never bind a parent/repo session via prefix.
          const match = sessions.find(
            (s) =>
              (s.directory && norm(s.directory) === wt) ||
              (s.path && norm(s.path) === wt),
          );
          if (match?.id) return match.id;
        }
      } catch {
        // fall through
      }
    }
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const args = ['--dir', thread.worktreePath];
    if (sessionId) args.push('--session', sessionId);
    return {
      file: 'opencode',
      args,
      cwd: thread.worktreePath,
      env: {
        OPENCODE_PERMISSION: permissionMode(thread).opencodePermission,
      },
    };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only: id, identifier, title, url, labels.';
    const { stdout, exitCode } = await run(
      'opencode',
      ['run', prompt, '--format', 'json'],
      {
        reject: false,
        env: { OPENCODE_PERMISSION: JSON.stringify({ '*': 'allow' }) },
      },
    );
    if (exitCode !== 0) return [];
    const texts: string[] = [];
    for (const line of stdout.split('\n')) {
      try {
        const obj = JSON.parse(line) as { type?: string; part?: { text?: string }; text?: string };
        if (obj.type === 'text') {
          texts.push(obj.part?.text ?? obj.text ?? '');
        }
      } catch {
        // ignore
      }
    }
    const joined = texts.join('');
    const match = joined.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return JSON.parse(match[0]) as IssueInfo[];
    } catch {
      return [];
    }
  },
};
