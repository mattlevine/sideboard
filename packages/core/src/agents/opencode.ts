import { existsSync } from 'node:fs';
import { run } from '../git/run.js';
import { resolveAgentExecutable } from '../store/app-settings.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage, formatUnknownDetail } from './error-detail.js';
import {
  buildInjectedMcpServers,
  shouldInjectBrightsyMcp,
  toOpencodeMcpConfigContent,
} from './injected-mcp.js';
import type { AgentModelInfo } from './model-info.js';
import { flattenTurnInput, dropCachedPrefixOnResume } from './turn-input.js';
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

  const opencode = resolveAgentExecutable('opencode');
  if (opencode === 'opencode') {
    const which = await run('which', ['opencode'], { reject: false });
    if (which.exitCode !== 0) return FALLBACK_OPENCODE_MODELS;
  } else if (!existsSync(opencode)) {
    return FALLBACK_OPENCODE_MODELS;
  }

  const listed = await run(opencode, ['models'], { reject: false });
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
  // OpenCode reports Anthropic-style cache (cache.read can exceed input) and
  // separate reasoning tokens that are not included in `output`.
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
    const opencode = resolveAgentExecutable('opencode');
    if (opencode !== 'opencode') {
      if (!existsSync(opencode)) {
        return {
          agent: 'opencode',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: `OpenCode executable not found: ${opencode}`,
        };
      }
    } else {
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
    }

    const auth = await run(opencode, ['auth', 'list'], { reject: false });
    const authenticated = auth.exitCode === 0 && auth.stdout.trim().length > 0;

    const mcp = await run(opencode, ['mcp', 'list'], { reject: false });
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
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const prompt = flattenTurnInput(dropCachedPrefixOnResume(input, sessionId));
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
    const isOrchestrator = isOrchestratorThread(thread);
    const injected = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: shouldInjectBrightsyMcp(thread, {
        orchestrator: isOrchestrator,
      }),
      orchestratorThreadId: isOrchestrator ? thread.id : null,
    });
    const mcpContent =
      injected.length > 0 ? toOpencodeMcpConfigContent(injected) : null;
    return {
      file: resolveAgentExecutable('opencode'),
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

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
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

      // Nearly every OpenCode JSONL event includes sessionID — only treat
      // step_start / bare session markers as session events. Returning early
      // on any sessionID drops text, tools, and usage (same trap as Claude).
      if (sid && (!obj.type || obj.type === 'step_start' || obj.type === 'session')) {
        return { type: 'session_id', data: sid };
      }

      if (obj.type === 'text') {
        const text =
          (obj as { part?: { text?: string }; text?: string }).part?.text ??
          (obj as { text?: string }).text;
        if (text) return { type: 'stdout', data: text };
      }
      if (obj.type === 'tool_use') {
        const part = (obj as {
          part?: {
            id?: string;
            callID?: string;
            tool?: string;
            name?: string;
            input?: Record<string, unknown>;
            state?: {
              status?: string;
              input?: Record<string, unknown>;
              output?: unknown;
              error?: unknown;
            };
          };
          id?: string;
          name?: string;
          tool?: string;
          input?: Record<string, unknown>;
        }).part;
        const id =
          part?.callID ??
          part?.id ??
          (obj as { id?: string }).id ??
          `tool-${Date.now()}`;
        const name =
          part?.tool ??
          part?.name ??
          (obj as { tool?: string; name?: string }).tool ??
          (obj as { name?: string }).name ??
          'tool';
        const state = part?.state;
        const input =
          (state?.input && typeof state.input === 'object'
            ? state.input
            : undefined) ??
          part?.input ??
          (obj as { input?: Record<string, unknown> }).input;
        const events: AgentEvent[] = [{ type: 'tool_use', id, name, input }];
        // OpenCode emits tool_use only when the call finishes (status completed).
        const output = state?.output;
        if (output != null || state?.status === 'completed' || state?.status === 'error') {
          const content =
            typeof output === 'string'
              ? output
              : output != null
                ? JSON.stringify(output)
                : formatUnknownDetail(state?.error) || undefined;
          events.push({
            type: 'tool_result',
            id,
            content,
            isError: state?.status === 'error' || state?.status === 'failed',
          });
        }
        return events.length === 1 ? events[0]! : events;
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
      // Usage is reported incrementally per agentic step; spawn sums billed
      // totals and keeps the last step for the context meter.
      if (obj.type === 'step_finish' || obj.type === 'step-finish') {
        const part = (obj as { part?: { tokens?: OpencodeTokens } }).part;
        const usage = usageFromOpencode(
          part?.tokens ?? (obj as { tokens?: OpencodeTokens }).tokens,
        );
        return usage ? { type: 'usage', data: usage, scope: 'request' } : null;
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
    const cachedId = cached?.trim() || null;
    const listed = await run(
      resolveAgentExecutable('opencode'),
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
          const forWorktree = sessions.filter(
            (s) =>
              (s.directory && norm(s.directory) === wt) ||
              (s.path && norm(s.path) === wt),
          );
          // Prefer the thread's own session when it still exists.
          if (cachedId && forWorktree.some((s) => s.id === cachedId)) {
            return cachedId;
          }
          if (cachedId && sessions.some((s) => s.id === cachedId)) {
            return cachedId;
          }
          // Stale cached id (missing from list) → start fresh for this chat.
          // Do NOT auto-adopt another tab's worktree session when cached is null —
          // sibling chats share a worktreePath and would otherwise merge sessions.
          return null;
        }
      } catch {
        // fall through
      }
    }
    // List failed / empty — keep cached if we have one (offline / CLI glitch).
    return cachedId;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const args = ['--dir', thread.worktreePath];
    if (sessionId) args.push('--session', sessionId);
    return {
      file: resolveAgentExecutable('opencode'),
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
      resolveAgentExecutable('opencode'),
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
