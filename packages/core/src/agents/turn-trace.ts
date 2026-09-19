import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';

/** Last-phase breadcrumb for hung worktree turns (`<app-data>/turn-spawn.log`). */
export function traceTurn(phase: string, extra?: Record<string, unknown>): void {
  try {
    const line = `${JSON.stringify({ t: new Date().toISOString(), phase, ...extra })}\n`;
    appendFileSync(join(appDataDir(), 'turn-spawn.log'), line);
  } catch {
    // ignore
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
