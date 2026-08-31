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

/** True once the first user turn (or a create failure) is visible in chat. */
export function threadHasVisibleFirstTurn(thread: FirstTurnThread): boolean {
  return (
    thread.messages.length > 0 ||
    (Boolean(thread.lastError) && thread.status !== 'running') ||
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
