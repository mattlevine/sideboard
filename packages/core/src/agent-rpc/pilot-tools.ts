import { AgentRpcClient } from './client.js';
import type { AgentRpcConnect } from './metadata.js';

export const PILOT_TOOL_NAMES = [
  'present_artifact',
  'wait_for_job',
  'stop_job',
] as const;

export type PilotToolName = (typeof PILOT_TOOL_NAMES)[number];

export const PILOT_TOOL_DESCRIPTIONS: Record<PilotToolName, string> = {
  present_artifact:
    'Show a document or live log in Sideboard’s side column. For html/svg/markdown/react, pass the FULL document and do not also fence that same body in chat. For type=log, pass only NEW lines (same artifact_id appends). Prefer type=log for long-running job output — do not resend HTML. type=react is a single default-export component (JSX/TSX); only react/react-dom imports.',
  wait_for_job:
    'Wait until a detached long job (tests, pack, deploy, connector CLI) finishes. This call stays open for up to ~2 minutes. stillRunning true means the runtime hit the max hold; call wait_for_job again immediately. If the job is hanging, producing no useful output, or doing the wrong thing, call stop_job instead. Do not end the turn or tell the user you will let them know later.',
  stop_job:
    'Stop a detached job you started with detached-job.cjs when it is hanging, producing no useful output, buffering forever, or doing the wrong thing (wrong project, infinite watch, huge dump). Do not stop a pack/test/deploy that is clearly making progress.',
};

export const WAIT_FOR_TURN_DESCRIPTION =
  'Wait until the chat finishes its current/queued turn, or return early with a live progress snapshot. This call stays open for up to ~2 minutes. taskState is the A2A-style lifecycle: submitted (queued, not started), working, input-required (ask_user), completed, failed, canceled. stillRunning is true only for submitted/working. If stillRunning, text and usage are empty (they would be the previous turn) — read progress and call wait_for_turn again. Do not send_to_chat a check-in (that steers / interrupts). On failed, lastError/text is the failure. On canceled, the child did not finish — resume with send_to_chat or tell the user. On input-required, wait for the user in that chat. When finished, text is this turn’s assistant reply and usage is that turn’s tokens + costUsd (this turn, not the Claude session total; sessionCostUsd is the provider session total when present). lastActivityAt is the latest transcript/live stamp — present after the turn completes, not only while it is running.';

export const WAIT_FOR_TURN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ref: {
      type: 'string',
      description: 'Worktree thread id or ref to wait on (not the orchestrator)',
    },
    timeoutMs: {
      type: 'number',
      description:
        'Optional cap for this hold (ms). Ignored above the runtime max (~2 minutes).',
    },
  },
  required: ['ref'],
};

export const PILOT_TOOL_SCHEMAS: Record<PilotToolName, Record<string, unknown>> = {
  present_artifact: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short title shown in the artifact pane header',
      },
      type: {
        type: 'string',
        enum: ['html', 'svg', 'markdown', 'react', 'log'],
        description:
          'html/svg/markdown/react replace the pane. log appends content to the same artifact_id (new lines only).',
      },
      content: {
        type: 'string',
        description:
          'html/svg/markdown/react: full document. log: only the new lines since the last call (empty is ok for a status-only update).',
      },
      artifact_id: {
        type: 'string',
        description: 'Stable id. Required for type=log so later calls append to the same pane.',
      },
      status: {
        type: 'string',
        enum: ['running', 'ok', 'failed', 'idle'],
      },
      phase: { type: 'string' },
      mode: { type: 'string', enum: ['append', 'replace'] },
    },
    required: ['title', 'type', 'content'],
  },
  wait_for_job: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Detached job id (same kebab-case id passed to detached-job.cjs start)',
      },
    },
    required: ['id'],
  },
  stop_job: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Detached job id (same kebab-case id passed to detached-job.cjs start)',
      },
      reason: { type: 'string' },
    },
    required: ['id'],
  },
};

export function jsonToolResult(value: unknown): string {
  return JSON.stringify(value);
}

export function jsonToolError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return jsonToolResult({ ok: false, error: message });
}

export type PilotRpcExecutorsOptions = {
  cwd: string;
  rpc: AgentRpcConnect;
  onProgress?: (params: unknown, toolCallId?: string) => void;
};

export type PilotToolContext = { toolCallId?: string };

export type PilotRpcExecutors = {
  present_artifact: (
    args: Record<string, unknown>,
    context?: PilotToolContext,
  ) => Promise<string>;
  wait_for_job: (
    args: Record<string, unknown>,
    context?: PilotToolContext,
  ) => Promise<string>;
  stop_job: (
    args: Record<string, unknown>,
    context?: PilotToolContext,
  ) => Promise<string>;
  wait_for_turn: (
    args: Record<string, unknown>,
    context?: PilotToolContext,
  ) => Promise<string>;
  close: () => void;
};

/** Shared execute() for harness hooks. Never throws into the runner. */
export function createPilotRpcExecutors(
  opts: PilotRpcExecutorsOptions,
): PilotRpcExecutors {
  const client = new AgentRpcClient(opts.rpc);
  let waitToolCallId: string | undefined;
  if (opts.onProgress) {
    const onProgress = opts.onProgress;
    client.onNotify((msg) => {
      if (msg.method === 'runtime.progress') onProgress(msg.params, waitToolCallId);
    });
  }

  const call = async (method: string, args: Record<string, unknown>): Promise<string> => {
    try {
      return jsonToolResult(await client.call(method, args));
    } catch (err) {
      return jsonToolError(err);
    }
  };
  const callJob = (method: string, args: Record<string, unknown>): Promise<string> =>
    call(method, { ...args, cwd: opts.cwd });

  return {
    present_artifact: (args) => call('ui.presentArtifact', args),
    wait_for_job: async (args, context) => {
      const prev = waitToolCallId;
      waitToolCallId =
        typeof context?.toolCallId === 'string' ? context.toolCallId : undefined;
      try {
        return await callJob('job.wait', args);
      } finally {
        waitToolCallId = prev;
      }
    },
    stop_job: (args) => callJob('job.stop', args),
    wait_for_turn: async (args, context) => {
      const prev = waitToolCallId;
      waitToolCallId =
        typeof context?.toolCallId === 'string' ? context.toolCallId : undefined;
      try {
        return await call('turn.wait', args);
      } finally {
        waitToolCallId = prev;
      }
    },
    close: () => client.close(),
  };
}
