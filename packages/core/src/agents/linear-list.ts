import type { IssueInfo } from '../types/thread.js';

const LIST_TIMEOUT_MS = 15_000;

/**
 * Assigned Linear issues via the connected API. Adapters used to spawn a
 * permissive agent (`bypassPermissions` / `* : allow`) just to list issues.
 */
export async function listAssignedLinearIssues(opts?: {
  timeoutMs?: number;
}): Promise<IssueInfo[]> {
  try {
    const { listLinearIssuesDirect } = await import('../integrations/linear.js');
    // Attach catch before the race. A rejection after the timeout already
    // returned [] would otherwise be an unhandled rejection.
    const listed = listLinearIssuesDirect({ limit: 50 }).catch(() => [] as IssueInfo[]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        listed,
        new Promise<IssueInfo[]>((resolve) => {
          timer = setTimeout(() => resolve([]), opts?.timeoutMs ?? LIST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return [];
  }
}
