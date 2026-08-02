import type { PrCheckRun } from '@sideboard/core';

export function formatCheckDuration(check: PrCheckRun): string {
  if (!check.startedAt || !check.completedAt) return '';
  const start = Date.parse(check.startedAt);
  const end = Date.parse(check.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function checkStatusLabel(bucket: string): string {
  switch (bucket) {
    case 'pass':
      return 'Passed';
    case 'fail':
      return 'Failed';
    case 'pending':
      return 'Pending';
    case 'skipping':
      return 'Skipped';
    case 'cancel':
      return 'Cancelled';
    default:
      return bucket || 'Unknown';
  }
}

export function summarizeChecks(checks: PrCheckRun[]): {
  failed: number;
  pending: number;
  passed: number;
  total: number;
  label: string;
} {
  let failed = 0;
  let pending = 0;
  let passed = 0;
  for (const c of checks) {
    if (c.bucket === 'fail') failed++;
    else if (c.bucket === 'pending') pending++;
    else if (c.bucket === 'pass') passed++;
  }
  const total = checks.length;
  let label = '';
  if (total === 0) label = '';
  else if (failed > 0) label = `Failed (${failed}/${total})`;
  else if (pending > 0) label = `Pending (${pending}/${total})`;
  else label = `Passed (${passed}/${total})`;
  return { failed, pending, passed, total, label };
}
