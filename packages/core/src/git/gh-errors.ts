/** Detect GitHub API / GraphQL rate-limit failures in gh CLI output. */
export function isGhRateLimitError(text: string): boolean {
  return /API rate limit (already )?exceeded/i.test(text) || /rate limit exceeded/i.test(text);
}

/** Relative wait hint from a Unix epoch reset timestamp (seconds). */
export function formatRateLimitResetHint(
  resetEpochSec: number,
  nowMs: number = Date.now(),
): string {
  const ms = resetEpochSec * 1000 - nowMs;
  if (ms <= 0) return 'soon';
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) {
    return `in about ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  const hours = Math.ceil(mins / 60);
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Prefer the trailing GraphQL/HTTP detail over the full `gh` command line
 * (which can include a huge --body payload).
 */
export function extractGhErrorDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const graphql = trimmed.match(/\bGraphQL:\s*(.+)$/im);
  if (graphql?.[1]) return `GraphQL: ${graphql[1].trim()}`;

  const http = trimmed.match(/\bHTTP\s+\d{3}:\s*(.+)$/im);
  if (http?.[1]) return `HTTP: ${http[1].trim()}`;

  // Execa: "Command failed with exit code N: gh …\n<stderr>"
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && /^Command failed with exit code/i.test(lines[0]!)) {
    return lines.slice(1).join(' ').trim() || lines[0]!;
  }

  return trimmed;
}

export type FormatGhLandErrorOptions = {
  /** Unix epoch seconds when the GraphQL/core quota resets. */
  resetAt?: number;
  /** Land push already succeeded before PR create failed. Default true for PR-create path. */
  pushed?: boolean;
  nowMs?: number;
  /** Repo Sideboard passed to `gh -R` (origin), when known. */
  targetedRepo?: string;
  /** Head ref passed to `gh pr create` (often `owner:branch`). */
  headRef?: string;
};

/**
 * Turn noisy `gh pr create` / Execa failures into a short notice for UI/CLI.
 */
export function formatGhLandError(
  raw: string,
  opts?: FormatGhLandErrorOptions,
): string {
  const trimmed = raw.trim();
  // Already humanized (e.g. main process included a reset hint).
  if (trimmed.startsWith('GitHub API rate limit exceeded.')) {
    return trimmed;
  }

  const detail = extractGhErrorDetail(raw);
  if (
    /Head ref must be a branch|No commits between|Head sha can't be blank/i.test(
      raw,
    ) ||
    /Head ref must be a branch|No commits between|Head sha can't be blank/i.test(
      detail,
    )
  ) {
    const target = opts?.targetedRepo
      ? ` Targeted ${opts.targetedRepo}`
      : '';
    const head = opts?.headRef ? ` with head ${opts.headRef}` : '';
    const hint = opts?.targetedRepo
      ? ` Branch was pushed to origin — confirm it exists on GitHub and differs from the base branch.${target}${head}.`
      : ' Often `gh` targeted upstream instead of origin. Branch was pushed — retry in the latest Sideboard, or run: gh pr create -R <owner/name> --base main --head <branch>.';
    return `Could not create the pull request.${hint}`;
  }
  if (isGhRateLimitError(raw) || isGhRateLimitError(detail)) {
    const when = opts?.resetAt
      ? ` Try again ${formatRateLimitResetHint(opts.resetAt, opts.nowMs)}.`
      : ' Wait a few minutes and try again.';
    const pushNote =
      opts?.pushed === false
        ? ''
        : ' Your branch was already pushed.';
    return `GitHub API rate limit exceeded.${pushNote}${when} Or create the pull request in the browser (Push & open on GitHub).`;
  }

  return detail || 'Failed to create or update pull request';
}

/** GitHub refused `gh pr merge` because the merge commit cannot be created. */
export function isPrNotMergeableError(text: string): boolean {
  return /not mergeable|cannot be cleanly created|cannot merge cleanly|Merge conflict|\bCONFLICTING\b|must be (updated|rebased)|branch is out of date|needs? to be (updated|rebased)|Resolve conflicts or update the branch/i.test(
    text,
  );
}

/** Short notice for a failed `gh pr merge` (drop the `--auto` hint). */
export function formatMergePrError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'gh pr merge failed';
  if (isPrNotMergeableError(trimmed)) {
    return 'This pull request cannot merge cleanly into the base branch. Resolve conflicts or update the branch, then retry.';
  }
  return extractGhErrorDetail(trimmed) || trimmed;
}

/** Strip Electron's IPC invoke wrapper, then humanize known gh failures. */
export function formatIpcInvokeError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  msg = msg.replace(/^ExecaError:\s*/i, '');
  msg = msg.replace(/^Error:\s*/i, '');
  if (isPrNotMergeableError(msg)) return formatMergePrError(msg);
  return formatGhLandError(msg);
}
