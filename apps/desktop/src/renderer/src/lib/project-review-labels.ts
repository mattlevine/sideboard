import type { PublicAppSettings } from '@sideboard-ai/core';

export function projectReviewLabelsFromSettings(
  projects: PublicAppSettings['projects'] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, profile] of Object.entries(projects ?? {})) {
    const label = profile.reviewLabel?.trim();
    if (label) out[path] = label;
  }
  return out;
}
