/** Thread fields the create overlay needs — keep this narrow for tests. */
export type FirstTurnThread = {
  id: string;
  messages: unknown[];
  lastError?: string | null;
  status?: string;
};

export type CreatePaneProgress = {
  mode: 'create' | 'cowboy' | 'orchestration' | 'archive' | 'remove';
  repoName: string;
  selectionHint: string | null;
  /** Set once create returns so we can hold the overlay on that chat. */
  threadId?: string;
  /**
   * First prompt is still being queued / sent. Keep the delete-style overlay
   * instead of an empty composer (which looks like you need to retype).
   */
  awaitingFirstPrompt?: boolean;
};

export function isSetupLastError(err: string | null | undefined): boolean {
  return /^Setup (exited|failed)\b/i.test(err?.trim() ?? '');
}

/** Same canned labels as `isRoutineStopNote` in core `stop-reason.ts`. */
export function isRoutineStopNote(err: string | null | undefined): boolean {
  const text = err?.trim() ?? '';
  return (
    text === 'Stopped' ||
    text === 'Stopped by the user' ||
    text === 'Stopped (queue cleared)' ||
    text === 'Stopped to send the next prompt'
  );
}

/** Setup leftovers and routine stops stay off the home-card preview. */
export function hidesLastErrorPreview(err: string | null | undefined, messageCount: number): boolean {
  if (isRoutineStopNote(err)) return true;
  return isSetupLastError(err) && messageCount === 0;
}

/** True once the first user turn (or a create failure) is visible in chat. */
export function threadHasVisibleFirstTurn(thread: FirstTurnThread): boolean {
  const err = thread.lastError?.trim();
  const showError =
    Boolean(err) &&
    !isSetupLastError(err) &&
    !isRoutineStopNote(err) &&
    thread.status !== 'running' &&
    thread.status !== 'queued';
  return (
    thread.messages.length > 0 ||
    showError ||
    thread.status === 'error' ||
    thread.status === 'broken'
  );
}

/**
 * Keep the create/archive processing pane instead of the selected thread
 * while a first prompt is still in flight.
 */
export function shouldHoldCreateOverlay(opts: {
  paneProgress: CreatePaneProgress | null;
  selected: FirstTurnThread | null;
}): boolean {
  const { paneProgress, selected } = opts;
  if (!paneProgress) return false;
  if (!selected) return true;
  if (!paneProgress.awaitingFirstPrompt || selected.id !== paneProgress.threadId) {
    return false;
  }
  return !threadHasVisibleFirstTurn(selected);
}
