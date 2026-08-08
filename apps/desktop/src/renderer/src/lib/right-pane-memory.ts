import type { RightPaneContent } from './right-pane';

/** Open right-column tabs for one chat (session memory). */
export interface RightPaneSession {
  tabs: RightPaneContent[];
  activeId: string | null;
}

/**
 * Per-chat right-column state for the session.
 * `null` = explicitly closed; missing = never set this session.
 */
const sessionByThread = new Map<string, RightPaneSession | null>();
const suppressedByThread = new Map<string, boolean>();
/** Last content the user closed — used to ignore the same payload reappearing. */
const closedByThread = new Map<string, RightPaneContent>();

export function getRememberedRightPaneSession(
  threadId: string,
): RightPaneSession | null | undefined {
  if (!sessionByThread.has(threadId)) return undefined;
  return sessionByThread.get(threadId);
}

export function rememberRightPaneSession(
  threadId: string,
  session: RightPaneSession | null,
): void {
  sessionByThread.set(threadId, session);
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
  sessionByThread.set(threadId, null);
  if (content) closedByThread.set(threadId, content);
  else closedByThread.delete(threadId);
}

export function getClosedRightPane(threadId: string): RightPaneContent | undefined {
  return closedByThread.get(threadId);
}

/** @deprecated use getRememberedRightPaneSession */
export function getRememberedRightPane(
  threadId: string,
): RightPaneContent | null | undefined {
  const s = getRememberedRightPaneSession(threadId);
  if (s === undefined) return undefined;
  if (s === null) return null;
  return s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0] ?? null;
}

/** @deprecated use rememberRightPaneSession */
export function rememberRightPane(
  threadId: string,
  content: RightPaneContent | null,
): void {
  if (content == null) {
    rememberRightPaneSession(threadId, null);
    return;
  }
  rememberRightPaneSession(threadId, { tabs: [content], activeId: content.id });
}
