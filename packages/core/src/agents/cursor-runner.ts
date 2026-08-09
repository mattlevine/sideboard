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
import { Agent, CursorAgentError, JsonlLocalAgentStore } from '@cursor/sdk';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { appDataDir } from '../store/paths.js';
import { formatUnknownDetail } from './error-detail.js';
import { cursorSdkMessageToEvents, type CursorTurnRequest } from './cursor-events.js';

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
function localAgentStore(): JsonlLocalAgentStore {
  const root = join(appDataDir(), 'cursor-sdk-store');
  mkdirSync(root, { recursive: true });
  return new JsonlLocalAgentStore(root);
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
  const store = localAgentStore();
  const local = { cwd: req.cwd, store };

  try {
    let agent;
    try {
      agent = req.agentId
        ? await Agent.resume(req.agentId, {
            apiKey,
            model,
            mode,
            local,
          })
        : await Agent.create({
            apiKey,
            model,
            mode,
            local,
            name: 'Sideboard',
          });
    } catch (err) {
      // Stale / purged cloud agent ids fail resume with "Agent … not found".
      // Start a fresh agent so follow-ups (and Review) aren't stuck on exit 1.
      const message = err instanceof Error ? err.message : String(err);
      if (!req.agentId || !/not found/i.test(message)) throw err;
      emit({
        type: 'stderr',
        data: `Cursor agent ${req.agentId} not found — starting a new session`,
      });
      agent = await Agent.create({
        apiKey,
        model,
        mode,
        local,
        name: 'Sideboard',
      });
    }

    try {
      emit({ type: 'session_id', data: agent.agentId });

      const run = await agent.send(req.prompt);
      for await (const msg of run.stream()) {
        for (const event of cursorSdkMessageToEvents(msg as never)) {
          emit(event);
        }
      }

      const result = await run.wait();
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
      return 0;
    } finally {
      await agent[Symbol.asyncDispose]();
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
