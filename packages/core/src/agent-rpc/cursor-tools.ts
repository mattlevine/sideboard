import { AgentRpcClient } from './client.js';
import type { AgentRpcConnect } from './metadata.js';

export type SideboardCursorRpcTool = {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: { toolCallId?: string },
  ) => Promise<string>;
};

const PRESENT_ARTIFACT_DESCRIPTION =
  'Show a document or live log in Sideboard’s side column. For html/svg/markdown/react, pass the FULL document and do not also fence that same body in chat. For type=log, pass only NEW lines (same artifact_id appends). Prefer type=log for long-running job output — do not resend HTML. type=react is a single default-export component (JSX/TSX); only react/react-dom imports.';

const WAIT_FOR_JOB_DESCRIPTION =
  'Wait until a detached long job (tests, pack, deploy, connector CLI) finishes. This call stays open for up to ~2 minutes. stillRunning true means the runtime hit the max hold; call wait_for_job again immediately. If the job is hanging, producing no useful output, or doing the wrong thing, call stop_job instead. Do not end the turn or tell the user you will let them know later.';

const STOP_JOB_DESCRIPTION =
  'Stop a detached job you started with detached-job.cjs when it is hanging, producing no useful output, buffering forever, or doing the wrong thing (wrong project, infinite watch, huge dump). Do not stop a pack/test/deploy that is clearly making progress.';

function jsonResult(value: unknown): string {
  return JSON.stringify(value);
}

function toolError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return jsonResult({ ok: false, error: message });
}

export type SideboardCursorRpcToolsOptions = {
  /** Worktree the agent runs in; job methods resolve `.context/jobs` here, not in the desktop cwd. */
  cwd: string;
  rpc: AgentRpcConnect;
  /**
   * Called for every `runtime.progress` notification while a job call is held.
   * The Cursor runner uses it to keep its stream-idle guard from ending the turn
   * and to push a partial `wait_for_job` result so the log pane updates.
   */
  onProgress?: (params: unknown, toolCallId?: string) => void;
};

export function sideboardCursorRpcTools(
  opts: SideboardCursorRpcToolsOptions,
): Record<string, SideboardCursorRpcTool> {
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
      return jsonResult(await client.call(method, args));
    } catch (err) {
      return toolError(err);
    }
  };
  const callJob = (method: string, args: Record<string, unknown>): Promise<string> =>
    call(method, { ...args, cwd: opts.cwd });

  return {
    present_artifact: {
      description: PRESENT_ARTIFACT_DESCRIPTION,
      inputSchema: {
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
      execute: (args) => call('ui.presentArtifact', args),
    },
    wait_for_job: {
      description: WAIT_FOR_JOB_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Detached job id (same kebab-case id passed to detached-job.cjs start)',
          },
        },
        required: ['id'],
      },
      execute: async (args, context) => {
        const prev = waitToolCallId;
        waitToolCallId =
          typeof context?.toolCallId === 'string' ? context.toolCallId : undefined;
        try {
          return await callJob('job.wait', args);
        } finally {
          waitToolCallId = prev;
        }
      },
    },
    stop_job: {
      description: STOP_JOB_DESCRIPTION,
      inputSchema: {
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
      execute: (args) => callJob('job.stop', args),
    },
  };
}
