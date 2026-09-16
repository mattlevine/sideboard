import { normalizeWorktreePath } from '../git/worktree-labels.js';
import type { ActiveRun } from '../types/thread.js';

export function worktreeProcessPrefix(worktreePath: string): string {
  return `wt:${normalizeWorktreePath(worktreePath)}`;
}

export function worktreeSetupProcessKey(worktreePath: string): string {
  return `${worktreeProcessPrefix(worktreePath)}:setup`;
}

export function worktreeRunProcessKey(worktreePath: string, scriptName: string): string {
  return `${worktreeProcessPrefix(worktreePath)}:run:${scriptName}`;
}

export function worktreeDevProcessKey(worktreePath: string): string {
  return `${worktreeProcessPrefix(worktreePath)}:dev`;
}

export function isWorktreeRunProcessKey(key: string, worktreePath: string): boolean {
  const prefix = worktreeProcessPrefix(worktreePath);
  return key.startsWith(`${prefix}:run:`) || key === `${prefix}:dev`;
}

/** Prefer a live setup, then the longest replayable log. */
export function pickRichestSetupLog<
  T extends { output: string; running: boolean; exitCode: number | null },
>(snaps: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const snap of snaps) {
    if (!snap.output && !snap.running && snap.exitCode == null) continue;
    if (!best) {
      best = snap;
      continue;
    }
    if (snap.running && !best.running) {
      best = snap;
      continue;
    }
    if (snap.running === best.running && snap.output.length > best.output.length) {
      best = snap;
    }
  }
  return best;
}

/** One Run pane per worktree — merge sibling chat records. */
export function mergeWorktreeActiveRuns(
  threads: readonly { activeRuns?: ActiveRun[]; devPort?: number | null }[],
): { activeRuns: ActiveRun[]; devPort: number | null } {
  const byName = new Map<string, ActiveRun>();
  let devPort: number | null = null;
  for (const thread of threads) {
    if (thread.devPort != null && devPort == null) devPort = thread.devPort;
    for (const run of thread.activeRuns ?? []) {
      if (!byName.has(run.scriptName)) byName.set(run.scriptName, run);
    }
  }
  return { activeRuns: [...byName.values()], devPort };
}
