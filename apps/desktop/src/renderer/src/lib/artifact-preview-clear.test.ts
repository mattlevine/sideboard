import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_PREVIEW_CLEAR_MS,
  artifactPreviewUrlsMatch,
  cancelArtifactPreviewClear,
  resetArtifactPreviewClears,
  scheduleArtifactPreviewClear,
} from './artifact-preview-clear';

describe('scheduleArtifactPreviewClear', () => {
  afterEach(() => {
    resetArtifactPreviewClears();
    vi.useRealTimers();
  });

  it('does not clear when a later mount cancels the same id', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    scheduleArtifactPreviewClear('a1', clear);
    cancelArtifactPreviewClear('a1');
    vi.advanceTimersByTime(ARTIFACT_PREVIEW_CLEAR_MS + 1);
    expect(clear).not.toHaveBeenCalled();
  });

  it('replaces a pending timer so Strict Mode unmount/remount does not delete', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    // First instance unmount.
    scheduleArtifactPreviewClear('a1', clear);
    // Second instance mount cancels, then its unmount would reschedule — remount:
    cancelArtifactPreviewClear('a1');
    vi.advanceTimersByTime(ARTIFACT_PREVIEW_CLEAR_MS + 1);
    expect(clear).not.toHaveBeenCalled();
  });

  it('fires once after the delay when nothing remounts', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    scheduleArtifactPreviewClear('a1', clear);
    vi.advanceTimersByTime(ARTIFACT_PREVIEW_CLEAR_MS - 1);
    expect(clear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('a1');
  });
});

describe('artifactPreviewUrlsMatch', () => {
  it('matches the same preview id and rev ignoring extra query', () => {
    expect(
      artifactPreviewUrlsMatch(
        'sideboard-artifact://preview/tool-a1?v=3',
        'sideboard-artifact://preview/tool-a1?v=3&x=1',
      ),
    ).toBe(true);
    expect(
      artifactPreviewUrlsMatch(
        'sideboard-artifact://preview/tool-a1?v=3',
        'sideboard-artifact://preview/tool-a1/?v=3',
      ),
    ).toBe(true);
  });

  it('rejects a different rev', () => {
    expect(
      artifactPreviewUrlsMatch(
        'sideboard-artifact://preview/tool-a1?v=3',
        'sideboard-artifact://preview/tool-a1?v=4',
      ),
    ).toBe(false);
  });
});
