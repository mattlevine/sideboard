/** GitHub’s documented pull-request body limit. */
export const GITHUB_PR_BODY_MAX_CHARS = 65_536;
/** Leave headroom so the GraphQL mutation itself stays under the request cap. */
export const GITHUB_PR_BODY_SAFE_CHARS = 60_000;

/** Detect GitHub API / GraphQL rate-limit failures in gh CLI output. */
export function isGhRateLimitError(text: string): boolean {
  return /API rate limit (already )?exceeded/i.test(text) || /rate limit exceeded/i.test(text);
}

/** `gh pr create` GraphQL mutation rejected because the request/PR body is huge. */
export function isGhPrBodyTooLongError(text: string): boolean {
  return /body is too long|body.{0,20}too long|maximum is 65536|exceeds the maximum allowed size|request (entity |is )?too large|payload too large|413 Request Entity Too Large/i.test(
    text,
  );
}

/** Trim a generated PR body so `gh pr create` does not blow the GraphQL limit. */
export function clampGithubPrBody(
  body: string,
  max = GITHUB_PR_BODY_SAFE_CHARS,
): string {
  const t = body.replace(/\s+$/u, '');
  if (t.length <= max) return t;
  const note = '\n\n_(truncated to fit GitHub’s PR body limit)_';
  const keep = Math.max(0, max - note.length);
  return `${t.slice(0, keep).replace(/\s+$/u, '')}${note}`;
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
function omitGhBodyArg(text: string): string {
  return text.replace(
    /--body(?:-file)?(\s+|=)(?:'[^']*'|"[^"]*"|\S+)/g,
    '--body <omitted>',
  );
}

function capGhErrorText(text: string, max = 400): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function extractGhErrorDetail(text: string): string {
  const trimmed = omitGhBodyArg(text.trim());
  if (!trimmed) return '';

  if (isGhPrBodyTooLongError(text) || isGhPrBodyTooLongError(trimmed)) {
    return 'GraphQL: body is too long (GitHub PR body / request size limit).';
  }

  const graphql = trimmed.match(/\bGraphQL:\s*(.+)$/im);
  if (graphql?.[1]) return capGhErrorText(`GraphQL: ${graphql[1].trim()}`);

  const http = trimmed.match(/\bHTTP\s+\d{3}:\s*(.+)$/im);
  if (http?.[1]) return capGhErrorText(`HTTP: ${http[1].trim()}`);

  // Execa: "Command failed with exit code N: gh …\n<stderr>"
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && /^Command failed with exit code/i.test(lines[0]!)) {
    return capGhErrorText(lines.slice(1).join(' ').trim() || lines[0]!);
  }

  return capGhErrorText(trimmed);
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
  if (isGhPrBodyTooLongError(raw) || isGhPrBodyTooLongError(detail)) {
    const pushNote =
      opts?.pushed === false ? '' : ' Your branch was already pushed.';
    return (
      `GitHub rejected the pull request: the GraphQL body is too long ` +
      `(PR description / request size, limit ${GITHUB_PR_BODY_MAX_CHARS} characters).` +
      `${pushNote} Retry with a short title and body via \`gh pr create --body-file\` ` +
      `(or send_to_thread so the worktree agent writes a brief description). ` +
      `Do not paste a changelog or diff into --body.`
    );
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
