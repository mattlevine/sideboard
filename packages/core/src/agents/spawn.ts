import { createInterface } from 'node:readline';
import { execa } from 'execa';
import { originGhRepoEnv } from '../git/worktree.js';
import { resolveAgentGitAuthEnv } from '../git/git-auth-mode.js';
import { childEnvWithAppSettings } from '../store/app-settings.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { AgentEvent, MessagePart, Thread, TokenUsage } from '../types/thread.js';
import { parseBrightsyCliLine } from './brightsy.js';
import { getAdapter } from './index.js';
import { assertOrchestratorCapableAgent } from './orchestrator-capable.js';
import {
  applyAgentEvent,
  finalizeParts,
  isBrightsyNdjsonLine,
  normalizeParseResult,
  partsToAssistantText,
  stripBrightsyNdjsonNoise,
} from './message-parts.js';
import { ensureAgentPath } from './path.js';
import { applyTurnUsage } from './usage.js';
import type { AgentTurnInput } from './turn-input.js';
import { createAgentStreamCoalescer } from './cursor-stream-coalesce.js';

export interface SpawnTurnHandle {
  pid: number | undefined;
  kill: () => void;
  done: Promise<{
    exitCode: number | null;
    sessionId: string | null;
    assistantText: string;
    parts: MessagePart[];
    usage: TokenUsage | null;
  }>;
}

export async function spawnAgentTurn(
  thread: Thread,
  input: string | AgentTurnInput,
  onEvent: (event: AgentEvent) => void,
): Promise<SpawnTurnHandle> {
  ensureAgentPath();
  if (!thread.worktreePath?.trim()) {
    throw new Error(
      `Cannot spawn ${thread.agent}: thread ${thread.id} has no worktreePath`,
    );
  }
  // Global orchestration chats use a synthetic empty cwd (not a git worktree).
  // Keep CLAUDE.md / AGENTS.md identity files fresh so Claude resume still knows its role.
  const { isGlobalThread } = await import('../store/global-workspace.js');
  if (isGlobalThread(thread)) {
    const { ensureGlobalCoordinatorCwd } = await import(
      '../orchestrator/coordinator-prompt.js'
    );
    ensureGlobalCoordinatorCwd(
      isOrchestratorThread(thread)
        ? { orchestratorThreadId: thread.id }
        : undefined,
    );
  }
  if (isOrchestratorThread(thread)) {
    assertOrchestratorCapableAgent(thread.agent);
  }
  const adapter = getAdapter(thread.agent);
  const cmd = await adapter.buildTurn(thread, input);
  if (cmd.cwd !== thread.worktreePath) {
    throw new Error(
      `Agent cwd must be the thread worktree (got ${cmd.cwd}, expected ${thread.worktreePath})`,
    );
  }

  // Pin bare `gh` to this worktree's origin (not upstream) for dual-remote repos.
  // HTTPS rewrite / GH_TOKEN / no-Keychain git follow Account → GitHub git-auth mode.
  const env = childEnvWithAppSettings(cmd.env);
  try {
    if (isOrchestratorThread(thread)) {
      Object.assign(env, await resolveAgentGitAuthEnv(env));
    } else {
      const originEnv = await originGhRepoEnv(thread.worktreePath, { env });
      Object.assign(env, originEnv);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[sideboard] git auth env failed (${thread.worktreePath}): ${detail}`);
  }

  const child = execa(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    env,
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
    // Claude stream-json turns write a user message to stdin; otherwise ignore
    // so Claude doesn't wait ~3s for an empty pipe.
    stdin: cmd.stdin != null ? 'pipe' : 'ignore',
  });

  if (cmd.stdin != null && child.stdin) {
    child.stdin.write(cmd.stdin);
    child.stdin.end();
  }

  let sessionId: string | null = thread.sessionId;
  let assistantText = '';
  let parts: MessagePart[] = [];
  let usage: TokenUsage | null = null;
  // Claude content_block_delta / Cursor SDK / similar token streams would
  // otherwise IPC + React-render on every word.
  const outbound = createAgentStreamCoalescer(onEvent);

  const consume = (stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr') => {
    if (!stream) return;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (kind === 'stderr') {
        outbound.push({ type: 'stderr', data: line });
        return;
      }
      let events = normalizeParseResult(adapter.parseEvent(line));
      // Brightsy CLI `--json` lines must become tool/thinking events, never answer text.
      if (thread.agent === 'brightsy' && kind === 'stdout' && isBrightsyNdjsonLine(line)) {
        const dumped = events.some(
          (e) => e.type === 'stdout' && isBrightsyNdjsonLine(e.data),
        );
        if (events.length === 0 || dumped) {
          events = normalizeParseResult(parseBrightsyCliLine(line));
        }
      }
      for (const parsed of events) {
        if (parsed.type === 'session_id') {
          sessionId = parsed.data;
          outbound.push(parsed);
          continue;
        }
        if (parsed.type === 'usage') {
          usage = applyTurnUsage(usage, parsed.data, parsed.scope ?? 'request');
          outbound.push(parsed);
          continue;
        }
        if (parsed.type === 'stdout') {
          if (thread.agent === 'brightsy' && isBrightsyNdjsonLine(parsed.data)) {
            continue;
          }
          // Claude emits assistant text then a result event with the same string.
          if (
            assistantText &&
            (parsed.data === assistantText || assistantText.endsWith(parsed.data))
          ) {
            continue;
          }
          assistantText += parsed.data;
        }
        parts = applyAgentEvent(parts, parsed);
        outbound.push(parsed);
      }
    });
  };

  consume(child.stdout, 'stdout');
  consume(child.stderr, 'stderr');

  const done = child.then((result) => {
    outbound.flush();
    const exitCode = result.exitCode ?? null;
    onEvent({ type: 'exit', data: exitCode });
    const finalized = finalizeParts(parts);
    const rawText = assistantText.trim() || partsToAssistantText(finalized);
    const text =
      thread.agent === 'brightsy' ? stripBrightsyNdjsonNoise(rawText) : rawText;
    return { exitCode, sessionId, assistantText: text, parts: finalized, usage };
  });

  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    done,
  };
}
