import type { IssueInfo } from '../types/thread.js';

const LIST_TIMEOUT_MS = 15_000;

/**
 * Assigned Linear issues via the connected API. Adapters used to spawn a
 * permissive agent (`bypassPermissions` / `* : allow`) just to list issues.
 */
export async function listAssignedLinearIssues(): Promise<IssueInfo[]> {
  try {
    const { listLinearIssuesDirect } = await import('../integrations/linear.js');
    return await Promise.race([
      listLinearIssuesDirect({ limit: 50 }),
      new Promise<IssueInfo[]>((resolve) => {
        setTimeout(() => resolve([]), LIST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  }
}
