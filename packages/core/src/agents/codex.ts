import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo, TokenUsage } from '../types/thread.js';
import { flattenTurnInput, normalizeTurnInput } from './turn-input.js';
import { permissionMode } from './types.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

/** macOS ARG_MAX ~256KiB — use `codex exec -` + stdin for larger prompts. */
export const CODEX_PROMPT_ARG_MAX = 200_000;

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
      const sid =
        (typeof obj.session_id === 'string' && obj.session_id) ||
        (typeof obj.thread_id === 'string' && obj.thread_id) ||
        (typeof (obj as { session?: { id?: string } }).session?.id === 'string' &&
          (obj as { session: { id: string } }).session.id);
      if (sid) return { type: 'session_id', data: sid };

      if (obj.type === 'turn.completed' || obj.type === 'turn_completed') {
        const usage = usageFromCodex((obj as { usage?: CodexUsage }).usage);
        return usage ? { type: 'usage', data: usage } : null;
      }

      if (typeof obj.item === 'object' && obj.item !== null) {
        const item = obj.item as { type?: string; text?: string };
        if (item.type === 'agent_message' && item.text) {
          return { type: 'stdout', data: item.text };
        }
      }
      if (typeof obj.content === 'string') {
        return { type: 'stdout', data: obj.content };
      }
      return { type: 'stdout', data: trimmed };
    } catch {
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
