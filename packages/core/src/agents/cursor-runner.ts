#!/usr/bin/env node
/**
 * Thin Node runner that bridges @cursor/sdk into Sideboard's CLI-shaped spawn loop.
 * Reads a JSON turn request from stdin; emits Sideboard AgentEvent NDJSON on stdout.
 *
 * Exit codes: 0 finished, 1 startup/config failure, 2 run failed mid-flight.
 */
import { Agent, CursorAgentError } from '@cursor/sdk';
import { createInterface } from 'node:readline';
import { cursorSdkMessageToEvents, type CursorTurnRequest } from './cursor-events.js';

function emit(event: unknown): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function modelSelection(model: string | null | undefined, fast: boolean) {
  const id = (model && model.trim()) || 'composer-2.5';
  if (fast) {
    return { id, params: [{ id: 'fast', value: 'true' as const }] };
  }
  return { id };
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
  const model = modelSelection(req.model, Boolean(req.fast));
  const mode = req.planMode ? ('plan' as const) : ('agent' as const);

  try {
    const agent = req.agentId
      ? await Agent.resume(req.agentId, {
          apiKey,
          model,
          mode,
          local: { cwd: req.cwd },
        })
      : await Agent.create({
          apiKey,
          model,
          mode,
          local: { cwd: req.cwd },
          name: 'Sideboard',
        });

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
        emit({
          type: 'stderr',
          data: `Cursor run failed (${result.id})${result.error ? `: ${String(result.error)}` : ''}`,
        });
        return 2;
      }
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
