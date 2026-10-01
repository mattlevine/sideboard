/** Debounced preview-map deletes, keyed by artifact id (not component instance). */

export const ARTIFACT_PREVIEW_CLEAR_MS = 10_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelArtifactPreviewClear(id: string): void {
  const prev = timers.get(id);
  if (prev != null) {
    clearTimeout(prev);
    timers.delete(id);
  }
}

/**
 * Schedule a preview HTML delete. A later mount of the same id (React Strict
 * Mode, tab switch) must call `cancelArtifactPreviewClear` first — a per-instance
 * ref cannot see the timeout from the unmounted tree, which left the map empty
 * and the iframe on the white "preview missing" page.
 */
export function scheduleArtifactPreviewClear(
  id: string,
  clear: (id: string) => void,
  ms = ARTIFACT_PREVIEW_CLEAR_MS,
): void {
  cancelArtifactPreviewClear(id);
  const handle = setTimeout(() => {
    timers.delete(id);
    clear(id);
  }, ms);
  timers.set(id, handle);
}

/** Test helper. */
export function resetArtifactPreviewClears(): void {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
}

/** True when the iframe's ready ping matches the URL we last published. */
export function artifactPreviewUrlsMatch(published: string, fromFrame: string): boolean {
  try {
    const a = new URL(published);
    const b = new URL(fromFrame);
    const pathA = a.pathname.replace(/\/$/, '');
    const pathB = b.pathname.replace(/\/$/, '');
    return (
      a.protocol === b.protocol &&
      a.host === b.host &&
      pathA === pathB &&
      (a.searchParams.get('v') ?? '') === (b.searchParams.get('v') ?? '')
    );
  } catch {
    return published === fromFrame;
  }
}
