import { existsSync, readFileSync } from 'node:fs';
import { cursorSdkRunsNdjsonSearchPaths } from './cursor-store.js';

export interface RecoveredCursorRun {
  runId: string;
  result: string;
  endedAt: number;
}

/**
 * Best-effort recovery when the local cursor-runner process dies but the SDK
 * store still recorded a finished run (cloud agent continued).
 */
export function recoverFinishedCursorRun(opts: {
  agentId: string;
  startedAfterMs: number;
  threadId?: string | null;
}): RecoveredCursorRun | null {
  const agentId = opts.agentId.trim();
  if (!agentId) return null;
  let best: RecoveredCursorRun | null = null;
  for (const runsPath of cursorSdkRunsNdjsonSearchPaths(opts.threadId)) {
    const hit = scanFinishedCursorRuns(runsPath, agentId, opts.startedAfterMs);
    if (hit && (!best || hit.endedAt >= best.endedAt)) best = hit;
  }
  return best;
}

function scanFinishedCursorRuns(
  runsPath: string,
  agentId: string,
  startedAfterMs: number,
): RecoveredCursorRun | null {
  if (!existsSync(runsPath)) return null;
  try {
    const lines = readFileSync(runsPath, 'utf8').split('\n');
    let best: RecoveredCursorRun | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: {
        agentId?: string;
        runId?: string;
        status?: string;
        result?: string | null;
        createdAt?: number;
        endedAt?: number | null;
      };
      try {
        row = JSON.parse(trimmed) as typeof row;
      } catch {
        continue;
      }
      if (row.agentId !== agentId) continue;
      if (row.status !== 'finished') continue;
      if (typeof row.result !== 'string' || !row.result.trim()) continue;
      const endedAt = typeof row.endedAt === 'number' ? row.endedAt : 0;
      const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0;
      if (createdAt < startedAfterMs && endedAt < startedAfterMs) continue;
      if (!best || endedAt >= best.endedAt) {
        best = { runId: row.runId || '', result: row.result.trim(), endedAt };
      }
    }
    return best;
  } catch {
    return null;
  }
}
