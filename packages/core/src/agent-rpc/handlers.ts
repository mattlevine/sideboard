import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  stopDetachedJob,
  waitForDetachedJob,
  type WaitForJobResult,
} from '../mcp/wait-for-job.js';
import {
  waitForTurnToolResult,
  type WaitForTurnToolResult,
} from '../mcp/wait-for-turn.js';
import {
  AGENT_RPC_JOB_HOLD_MAX_MS,
  AGENT_RPC_JOB_SLICE_MS,
  AGENT_RPC_PROTOCOL_VERSION,
} from './protocol.js';

export type AgentRpcNotify = (method: string, params?: unknown) => void;

export type AgentRpcCallContext = {
  /** Unused by job methods — those require an absolute `cwd` in params. */
  cwd: string;
  threadId?: string | null;
  notify: AgentRpcNotify;
};

export type AgentRpcHandler = (
  params: unknown,
  ctx: AgentRpcCallContext,
) => Promise<unknown>;

export type PresentArtifactParams = {
  title: string;
  type: 'html' | 'svg' | 'markdown' | 'react' | 'log';
  artifact_id?: string;
  status?: 'running' | 'ok' | 'failed' | 'idle';
  phase?: string;
  mode?: 'append' | 'replace';
};

export function presentArtifactResult(input: PresentArtifactParams): {
  ok: true;
  artifact_id: string;
  title: string;
  type: PresentArtifactParams['type'];
  status?: PresentArtifactParams['status'];
  phase?: string;
  mode?: 'append' | 'replace';
  message: string;
} {
  const id =
    input.artifact_id?.trim() ||
    `artifact_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  return {
    ok: true,
    artifact_id: id,
    title: input.title,
    type: input.type,
    status: input.status,
    phase: input.phase,
    mode: input.type === 'log' ? (input.mode ?? 'append') : undefined,
    message:
      input.type === 'log'
        ? 'Log accepted. Same artifact_id appends; send only new lines next time.'
        : 'Artifact accepted. Sideboard desktop opens it in the side column beside chat.',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function invalidParams(message: string): Error {
  return Object.assign(new Error(message), { rpcCode: -32602 });
}

/**
 * Job methods act on the agent's worktree, not the runtime's cwd. The
 * desktop runs from `/` when packaged, so the client must send `cwd`.
 */
function jobCwd(rec: Record<string, unknown>): string {
  const raw = str(rec.cwd).trim();
  if (!raw) throw invalidParams('cwd is required');
  if (!isAbsolute(raw)) throw invalidParams('cwd must be an absolute path');
  return raw;
}

export async function handleRuntimePing(
  _params: unknown,
  _ctx: AgentRpcCallContext,
): Promise<{ ok: true; protocolVersion: number; pid: number }> {
  return {
    ok: true,
    protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
    pid: process.pid,
  };
}

export async function handlePresentArtifact(
  params: unknown,
  _ctx: AgentRpcCallContext,
): Promise<ReturnType<typeof presentArtifactResult>> {
  const rec = asRecord(params);
  const title = str(rec.title).trim();
  const type = str(rec.type).trim();
  const allowed = ['html', 'svg', 'markdown', 'react', 'log'] as const;
  if (!title) throw invalidParams('title is required');
  if (!allowed.includes(type as (typeof allowed)[number])) {
    throw invalidParams('type must be html, svg, markdown, react, or log');
  }
  const statusRaw = str(rec.status).trim();
  const status = (['running', 'ok', 'failed', 'idle'] as const).includes(
    statusRaw as 'running',
  )
    ? (statusRaw as PresentArtifactParams['status'])
    : undefined;
  const modeRaw = str(rec.mode).trim();
  const mode =
    modeRaw === 'append' || modeRaw === 'replace'
      ? modeRaw
      : undefined;
  return presentArtifactResult({
    title,
    type: type as PresentArtifactParams['type'],
    artifact_id: str(rec.artifact_id) || undefined,
    status,
    phase: str(rec.phase) || undefined,
    mode,
  });
}

export type JobWaitFn = (
  cwd: string,
  id: string,
  opts?: { timeoutMs?: number },
) => Promise<WaitForJobResult>;

export async function handleJobWait(
  params: unknown,
  ctx: AgentRpcCallContext,
  waitFn: JobWaitFn = waitForDetachedJob,
): Promise<WaitForJobResult> {
  const rec = asRecord(params);
  const id = str(rec.id).trim();
  if (!id) throw invalidParams('id is required');
  const cwd = jobCwd(rec);
  const deadline = Date.now() + AGENT_RPC_JOB_HOLD_MAX_MS;
  let last: WaitForJobResult | undefined;
  while (Date.now() < deadline) {
    const slice = Math.min(AGENT_RPC_JOB_SLICE_MS, Math.max(50, deadline - Date.now()));
    last = await waitFn(cwd, id, { timeoutMs: slice });
    if (!last.stillRunning) return last;
    ctx.notify('runtime.progress', last);
  }
  return (
    last ?? {
      stillRunning: true,
      ok: false,
      failed: false,
      status: 'running',
      id,
      delta: '',
      progress: 'Job still running after max hold. Call wait_for_job again.',
      hint: 'The RPC hold cap was reached. Call wait_for_job again — do not assume success.',
    }
  );
}

export async function handleJobStop(
  params: unknown,
  _ctx: AgentRpcCallContext,
): Promise<unknown> {
  const rec = asRecord(params);
  const id = str(rec.id).trim();
  if (!id) throw invalidParams('id is required');
  const reason = str(rec.reason).trim() || undefined;
  return stopDetachedJob(jobCwd(rec), id, reason ? { reason } : undefined);
}

export type TurnWaitFn = (
  ref: string,
  timeoutMs: number,
) => Promise<WaitForTurnToolResult>;

async function defaultTurnWait(
  ref: string,
  timeoutMs: number,
): Promise<WaitForTurnToolResult> {
  const { getOrchestrator } = await import('../orchestrator/orchestrator.js');
  const orch = getOrchestrator();
  const thread = await orch.waitForTurn(ref, timeoutMs, {
    resolveIfStillRunning: true,
  });
  const result = orch.getTurnResult(thread.id);
  return waitForTurnToolResult({
    id: thread.id,
    status: result.status,
    taskState: result.taskState,
    text: result.text,
    lastError: result.lastError,
    stillRunning: result.stillRunning,
    progress: result.progress,
    lastActivityAt: result.lastActivityAt,
  });
}

export async function handleTurnWait(
  params: unknown,
  ctx: AgentRpcCallContext,
  waitFn: TurnWaitFn = defaultTurnWait,
): Promise<WaitForTurnToolResult> {
  const rec = asRecord(params);
  const ref = str(rec.ref).trim();
  if (!ref) throw invalidParams('ref is required');
  const requested =
    typeof rec.timeoutMs === 'number' && Number.isFinite(rec.timeoutMs)
      ? rec.timeoutMs
      : undefined;
  const holdMax =
    requested !== undefined
      ? Math.min(Math.max(1_000, Math.floor(requested)), AGENT_RPC_JOB_HOLD_MAX_MS)
      : AGENT_RPC_JOB_HOLD_MAX_MS;
  const deadline = Date.now() + holdMax;
  let last: WaitForTurnToolResult | undefined;
  while (Date.now() < deadline) {
    const slice = Math.min(AGENT_RPC_JOB_SLICE_MS, Math.max(50, deadline - Date.now()));
    last = await waitFn(ref, slice);
    if (!last.stillRunning) return last;
    ctx.notify('runtime.progress', last);
  }
  return (
    last ?? {
      id: ref,
      status: 'running',
      taskState: 'working',
      text: '',
      lastError: null,
      stillRunning: true,
      progress: null,
      lastActivityAt: null,
      hint: 'Child is still working after max hold. Call wait_for_turn again. Do not send_to_chat a check-in (that steers / interrupts).',
      incomplete: false,
    }
  );
}

export function createAgentRpcDispatcher(): Record<string, AgentRpcHandler> {
  return {
    'runtime.ping': handleRuntimePing,
    'ui.presentArtifact': handlePresentArtifact,
    'job.wait': handleJobWait,
    'job.stop': handleJobStop,
    'turn.wait': handleTurnWait,
  };
}
