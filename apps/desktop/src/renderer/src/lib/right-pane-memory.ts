import type { RightPaneContent } from './right-pane';

/**
 * Per-chat right-column state for the session.
 * `null` = explicitly closed; missing = never set this session.
 */
const contentByThread = new Map<string, RightPaneContent | null>();
const suppressedByThread = new Map<string, boolean>();
/** Last content the user closed — used to ignore the same payload reappearing. */
const closedByThread = new Map<string, RightPaneContent>();

export function getRememberedRightPane(
  threadId: string,
): RightPaneContent | null | undefined {
  if (!contentByThread.has(threadId)) return undefined;
  return contentByThread.get(threadId);
}

export function rememberRightPane(
  threadId: string,
  content: RightPaneContent | null,
): void {
  contentByThread.set(threadId, content);
}

export function isRightPaneSuppressed(threadId: string): boolean {
  return suppressedByThread.get(threadId) === true;
}

export function setRightPaneSuppressed(threadId: string, suppressed: boolean): void {
  suppressedByThread.set(threadId, suppressed);
  if (!suppressed) closedByThread.delete(threadId);
}

export function rememberClosedRightPane(
  threadId: string,
  content: RightPaneContent | null,
): void {
  suppressedByThread.set(threadId, true);
  contentByThread.set(threadId, null);
  if (content) closedByThread.set(threadId, content);
  else closedByThread.delete(threadId);
}

export function getClosedRightPane(threadId: string): RightPaneContent | undefined {
  return closedByThread.get(threadId);
}
