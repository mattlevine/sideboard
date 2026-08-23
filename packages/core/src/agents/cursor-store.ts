import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';

/** App-data folder that holds Cursor SDK JSONL catalogs. */
export const CURSOR_SDK_STORE_DIR = 'cursor-sdk-store';

/**
 * JsonlLocalAgentStore only serializes writes inside one process. Sideboard
 * spawns a runner per turn, so concurrent Cursor chats must not share
 * agents.ndjson / runs.ndjson (last writer drops the other run →
 * `Run … not found for agent …`).
 */
export function cursorSdkStoreDir(threadId?: string | null): string {
  const root = join(appDataDir(), CURSOR_SDK_STORE_DIR);
  const id = sanitizeCursorStoreSegment(threadId);
  if (!id) return root;
  return join(root, 'threads', id);
}

export function cursorSdkRunsNdjsonPath(threadId?: string | null): string {
  return join(cursorSdkStoreDir(threadId), 'runs.ndjson');
}

/** Thread-scoped catalog first, then the legacy shared file (pre-isolation). */
export function cursorSdkRunsNdjsonSearchPaths(threadId?: string | null): string[] {
  const scoped = cursorSdkRunsNdjsonPath(threadId);
  const shared = cursorSdkRunsNdjsonPath(null);
  if (!threadId || !sanitizeCursorStoreSegment(threadId) || scoped === shared) {
    return [shared];
  }
  return [scoped, shared];
}

function sanitizeCursorStoreSegment(threadId?: string | null): string {
  return (threadId ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}
