/** Node-free labels for renderer + core. Do not import app-settings from here. */

export const ISSUE_SOURCE_LABELS = {
  github: 'GitHub',
  linear: 'Linear',
  abletime: 'AbleTime',
} as const;

export function issueSourceLabel(source: string | null | undefined): string {
  if (source && source in ISSUE_SOURCE_LABELS) {
    return ISSUE_SOURCE_LABELS[source as keyof typeof ISSUE_SOURCE_LABELS];
  }
  const trimmed = source?.trim();
  return trimmed || 'Issues';
}
