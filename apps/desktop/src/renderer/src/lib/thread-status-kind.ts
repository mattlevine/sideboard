import type { ThreadStatus } from '@sideboard-ai/core';

export type ThreadStatusKind =
  | 'running'
  | 'queued'
  | 'error'
  | 'blocked'
  | 'dirty'
  | 'idle'
  | 'archived';

/**
 * Error and archived stay themselves. A blocked agent (waiting on a person)
 * outranks running, queued, and dirty — same priority as Herdr.
 */
export function threadStatusKind(
  status: ThreadStatus,
  dirty: boolean,
  blocked = false,
): ThreadStatusKind {
  if (status === 'archived') return 'archived';
  if (status === 'error' || status === 'broken') return 'error';
  if (blocked) return 'blocked';
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (dirty) return 'dirty';
  return 'idle';
}
