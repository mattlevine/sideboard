#!/usr/bin/env node
/**
 * Thin Node runner that bridges @cursor/sdk into Sideboard's CLI-shaped spawn loop.
 * Reads a JSON turn request from stdin; emits Sideboard AgentEvent NDJSON on stdout.
 *
 * Exit codes: 0 finished, 1 startup/config failure, 2 run failed mid-flight.
 *
 * Uses {@link JsonlLocalAgentStore} instead of the SDK's default SQLite store:
 * Electron's embedded Node (used via ELECTRON_RUN_AS_NODE) lacks `node:sqlite`.
 */
import { Agent, CursorAgentError, JsonlLocalAgentStore, type LocalAgentOptions } from '@cursor/sdk';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dropNestedElectronEnvFromProcess } from '../hook/nested-electron-env.js';
import { ensureCursorRipgrepPath } from './cursor-ripgrep.js';
import { cursorSdkStoreDir } from './cursor-store.js';
import {
  CURSOR_STREAM_IDLE_MS,
  cursorSendOptions,
  cursorSessionRecoveryMessage,
  isAgentBusyError,
  isUnresumableCursorSession,
  cursorRetryableTransportMessage,
  iterateUntilIdle,
  retryOnceOnRetryableCursorError,
  withCursorLocalHangGuards,
} from './cursor-session.js';
import { formatUnknownDetail } from './error-detail.js';
import {
  cursorCostOnlyUsageEvent,
  cursorDeltaToEvents,
  cursorSdkMessageToEvents,
  fetchCursorTurnCostUsd,
  type CursorAgentUsageSnapshot,
  type CursorTurnRequest,
} from './cursor-events.js';
import { createAgentStreamCoalescer } from './cursor-stream-coalesce.js';

// Electron-as-Node already started this process. Drop inherited ELECTRON_*/
// CHROME_* so the Cursor local agent and MCP children do not attach to
// Sideboard.app's GPU/crashpad (HasCustomHostObject / ICU startup crash).
dropNestedElectronEnvFromProcess();
// Local indexing uses rg; asar paths are not executable — pin unpacked/bin/rg.
ensureCursorRipgrepPath();

function emit(event: unknown): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function modelSelection(
  model: string | null | undefined,
  opts: { effort?: string | null; fast?: boolean },
) {
  // Cursor.models.list uses id "default" for Auto.
  const raw = (model && model.trim()) || '';
  const id =
    !raw || raw.toLowerCase() === 'auto' || raw.toLowerCase() === 'default'
      ? 'default'
      : raw;
  const params: Array<{ id: string; value: string }> = [];
  const effort = (opts.effort ?? '').trim().toLowerCase();
  const normalized =
    effort === 'normal'
      ? 'medium'
      : effort === 'low' ||
          effort === 'medium' ||
          effort === 'high' ||
          effort === 'xhigh' ||
          effort === 'max'
        ? effort
        : '';
  if (normalized) {
    params.push({ id: 'effort', value: normalized });
  }
  if (opts.fast) {
    params.push({ id: 'fast', value: 'true' });
  }
  return params.length > 0 ? { id, params } : { id };
}

/** Durable local agent metadata (Conductor-style JSONL, not SQLite). */
function localAgentStore(threadId?: string | null): JsonlLocalAgentStore {
  const root = cursorSdkStoreDir(threadId);
  mkdirSync(root, { recursive: true });
  return new JsonlLocalAgentStore(root);
}

/**
 * Cancel leftover local runs so a follow-up `send` can proceed.
 * Happens when a previous runner process died without waiting/cancelling.
 */
async function cancelStaleLocalRuns(
  agentId: string,
  opts: { cwd: string; store: JsonlLocalAgentStore },
): Promise<number> {
  const listed = await Agent.listRuns(agentId, {
    runtime: 'local',
    cwd: opts.cwd,
    store: opts.store,
    limit: 20,
  });
  let cancelled = 0;
  for (const run of listed.items) {
    if (run.status !== 'running') continue;
    try {
      await Agent.cancelRun(run.id, {
        runtime: 'local',
        cwd: opts.cwd,
        store: opts.store,
      });
      cancelled += 1;
    } catch {
      /* best-effort */
    }
  }
  return cancelled;
}

async function readStdinJson(): Promise<CursorTurnRequest> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const chunks: string[] = [];
  for await (const line of rl) {
    chunks.push(line);
  }
  const raw = chunks.join('\n').trim();
  if (!raw) throw new Error('cursor-runner: empty stdin (expected JSON CursorTurnRequest)');
  return JSON.parse(raw) as CursorTurnRequest;
}

async function main(): Promise<number> {
  let req: CursorTurnRequest;
  try {
    req = await readStdinJson();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'stderr', data: message });
    return 1;
  }

  if (!req.prompt?.trim()) {
    emit({ type: 'stderr', data: 'cursor-runner: prompt is required' });
    return 1;
  }
  if (!req.cwd?.trim()) {
    emit({ type: 'stderr', data: 'cursor-runner: cwd is required' });
    return 1;
  }

  const apiKey = (req.apiKey || process.env.CURSOR_API_KEY || '').trim() || undefined;
  const model = modelSelection(req.model, {
    effort: req.effort,
    fast: Boolean(req.fast),
  });
  const mode = req.planMode ? ('plan' as const) : ('agent' as const);
  const store = localAgentStore(req.threadId);
  const isolateSources: NonNullable<LocalAgentOptions['settingSources']> = [];
  const local = withCursorLocalHangGuards({
    cwd: req.cwd,
    store,
    ...(req.isolateAmbientMcp ? { settingSources: isolateSources } : {}),
  });
  // Inline MCP is not persisted on resume — pass every turn (create + resume + send).
  const mcpServers =
    req.mcpServers && Object.keys(req.mcpServers).length > 0
      ? req.mcpServers
      : undefined;
  const createOpts = {
    apiKey,
    model,
    mode,
    local,
    name: 'Sideboard' as const,
    ...(mcpServers ? { mcpServers } : {}),
  };

  const retryTransport = <T>(fn: () => Promise<T>): Promise<T> =>
    retryOnceOnRetryableCursorError(fn, (err) => {
      emit({ type: 'stderr', data: cursorRetryableTransportMessage(err) });
    });

  async function createAgent() {
    return retryTransport(() => Agent.create(createOpts));
  }

  async function openAgent() {
    try {
      return req.agentId
        ? await retryTransport(() =>
            Agent.resume(req.agentId!, {
              apiKey,
              model,
              mode,
              local,
              ...(mcpServers ? { mcpServers } : {}),
            }),
          )
        : await createAgent();
    } catch (err) {
      // Stale / purged cloud ids, cwd-reused dead agents, and JSONL checkpoints
      // whose root blob never landed ("Corrupt local agent checkpoint").
      if (!isUnresumableCursorSession(err)) throw err;
      emit({
        type: 'stderr',
        data: cursorSessionRecoveryMessage(err, req.agentId),
      });
      return createAgent();
    }
  }

  async function sendPrompt(
    agent: Awaited<ReturnType<typeof createAgent>>,
    extra?: { onDelta?: (args: { update: unknown }) => void },
  ) {
    const sendOpts = {
      ...cursorSendOptions(mcpServers),
      ...extra,
    };
    try {
      return await retryTransport(() => agent.send(req.prompt, sendOpts));
    } catch (err) {
      if (!isAgentBusyError(err)) throw err;
      const n = await cancelStaleLocalRuns(agent.agentId, {
        cwd: req.cwd,
        store,
      });
      emit({
        type: 'stderr',
        data:
          n > 0
            ? `Cursor agent had ${n} stale active run(s) — cancelled and retrying`
            : 'Cursor agent busy — retrying send',
      });
      return retryTransport(() => agent.send(req.prompt, sendOpts));
    }
  }

  type LiveRun = {
    cancel: () => Promise<unknown>;
  };
  let liveRun: LiveRun | null = null;
  let shuttingDown = false;

  const cancelLiveRun = async (): Promise<void> => {
    const run = liveRun;
    liveRun = null;
    if (!run) return;
    try {
      await run.cancel();
    } catch {
      /* best-effort — persisted RUNNING is expired on the next send(force) */
    }
  };

  const onSignal = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void Promise.race([
      cancelLiveRun(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]).finally(() => process.exit(1));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  async function runTurn(agent: Awaited<ReturnType<typeof createAgent>>): Promise<number> {
    emit({ type: 'session_id', data: agent.agentId });
    const stream = createAgentStreamCoalescer(emit);
    const activity = { at: Date.now() };
    const bump = (): void => {
      activity.at = Date.now();
    };

    let usageBefore: CursorAgentUsageSnapshot | null = null;
    try {
      usageBefore = (await agent.getUsage()) as CursorAgentUsageSnapshot;
    } catch {
      /* best-effort — new-run cost may still appear without a before snapshot */
    }

    let lastUsageRunId: string | undefined;
    const run = await sendPrompt(agent, {
      onDelta: ({ update }) => {
        bump();
        for (const event of cursorDeltaToEvents(update as never)) {
          stream.push(event);
        }
      },
    });
    liveRun = run;
    let streamIdle = false;
    try {
      for await (const msg of iterateUntilIdle(
        run.stream(),
        CURSOR_STREAM_IDLE_MS,
        () => {
          streamIdle = true;
          emit({
            type: 'stderr',
            data: 'Cursor stream idle — finishing the turn (SDK stream did not close)',
          });
          void cancelLiveRun();
        },
        activity,
      )) {
        bump();
        const sdkMsg = msg as { type?: string; run_id?: string };
        if (sdkMsg.type === 'usage' && typeof sdkMsg.run_id === 'string' && sdkMsg.run_id.trim()) {
          lastUsageRunId = sdkMsg.run_id.trim();
        }
        for (const event of cursorSdkMessageToEvents(msg as never)) {
          stream.push(event);
        }
      }
      stream.flush();

      const result = streamIdle
        ? await Promise.race([
            run.wait(),
            new Promise<{ status: 'cancelled' }>((resolve) => {
              setTimeout(() => resolve({ status: 'cancelled' }), 5_000);
            }),
          ])
        : await run.wait();
      if (result.status === 'error') {
        const detail = formatUnknownDetail(result.error);
        emit({
          type: 'stderr',
          data: detail
            ? `Cursor run failed (${result.id}): ${detail}`
            : `Cursor run failed (${result.id})`,
        });
        return 2;
      }
      // User stop / abort — not a failure for lastError.
      if (result.status === 'cancelled') return 0;

      // Billed USD is not on the stream — pull getUsage when the account supports it.
      try {
        const costUsd = await fetchCursorTurnCostUsd(
          (opts) => agent.getUsage(opts) as Promise<CursorAgentUsageSnapshot>,
          usageBefore,
          { runId: lastUsageRunId },
        );
        if (costUsd != null) {
          emit(cursorCostOnlyUsageEvent(costUsd));
        }
      } catch {
        /* best-effort */
      }
      return 0;
    } finally {
      stream.flush();
      liveRun = null;
    }
  }

  try {
    let agent = await openAgent();
    try {
      try {
        return await runTurn(agent);
      } catch (err) {
        // send() can throw the same unresumable errors after a "successful" resume.
        if (!isUnresumableCursorSession(err)) throw err;
        emit({
          type: 'stderr',
          data: cursorSessionRecoveryMessage(err, agent.agentId),
        });
        await agent[Symbol.asyncDispose]().catch(() => undefined);
        agent = await createAgent();
        return await runTurn(agent);
      }
    } finally {
      await agent[Symbol.asyncDispose]().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof CursorAgentError) {
      emit({
        type: 'stderr',
        data: `Cursor startup failed: ${err.message}${err.isRetryable ? ' (retryable)' : ''}`,
      });
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'stderr', data: message });
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    emit({ type: 'stderr', data: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  },
);
