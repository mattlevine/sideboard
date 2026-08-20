import type { ThreadStatus } from '@sideboard-ai/core';

export type ThreadStatusKind =
  | 'running'
  | 'queued'
  | 'error'
  | 'dirty'
  | 'idle'
  | 'archived';

/** Run/error wins over git dirty so a busy or failed agent is never a green circle. */
export function threadStatusKind(
  status: ThreadStatus,
  dirty: boolean,
): ThreadStatusKind {
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (status === 'error' || status === 'broken') return 'error';
  if (status === 'archived') return 'archived';
  if (dirty) return 'dirty';
  return 'idle';
}
