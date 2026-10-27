import { randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clampGithubPrBody, formatGhLandError, isGhRateLimitError } from './gh-errors.js';
import { gh } from './run.js';
import { createOrUpdateCursorPr } from './cursor-pr.js';
import {
  ensureGhPreferOrigin,
  entireUsesTrails,
  ghHeadRef,
  ghRepoSelectArgs,
  resolveGithubRepoSlug,
  resolveOriginRemote,
} from './worktree.js';

/** Best-effort GraphQL reset time from `gh api rate_limit` (REST; often still available). */
async function lookupGithubGraphqlReset(cwd: string): Promise<number | undefined> {
  const result = await gh(['api', 'rate_limit'], cwd, { reject: false });
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  try {
    const data = JSON.parse(result.stdout) as {
      resources?: { graphql?: { reset?: number } };
    };
    const reset = data.resources?.graphql?.reset;
    return typeof reset === 'number' ? reset : undefined;
  } catch {
    return undefined;
  }
}

async function formatPrCreateFailure(
  raw: string,
  cwd: string,
  ctx?: { slug?: string; head?: string },
): Promise<string> {
  if (!isGhRateLimitError(raw)) {
    return formatGhLandError(raw, {
      targetedRepo: ctx?.slug,
      headRef: ctx?.head,
    });
  }
  const resetAt = await lookupGithubGraphqlReset(cwd);
  return formatGhLandError(raw, {
    resetAt,
    targetedRepo: ctx?.slug,
    headRef: ctx?.head,
  });
}

async function createCursorPullRequest(
  worktreePath: string,
  slug: string,
  opts: {
    title: string;
    body?: string;
    base: string;
    head: string;
    draft?: boolean;
    web?: boolean;
  },
): Promise<string> {
  const bodyText = (opts.body ?? opts.title).trim() || opts.title;
  const bodyFile = join(
    tmpdir(),
    `sideboard-pr-body-${process.pid}-${randomBytes(6).toString('hex')}.md`,
  );
  writeFileSync(bodyFile, bodyText.endsWith('\n') ? bodyText : `${bodyText}\n`, 'utf8');
  try {
    return await createOrUpdateCursorPr(worktreePath, slug, {
      title: opts.title,
      bodyFile,
      base: opts.base,
      head: opts.head,
      draft: opts.draft,
    });
  } finally {
    try {
      unlinkSync(bodyFile);
    } catch {
      // temp file
    }
  }
}

/**
 * Assign a newly created PR to the GitHub-connected account (`@me`) unless
 * the caller named a different login or opted out with none/unassigned.
 */
export function ghPrCreateAssigneeArgs(assignee?: string | null): string[] {
  const raw = assignee?.trim();
  if (raw && /^(none|unassigned)$/i.test(raw)) return [];
  return ['--assignee', raw || '@me'];
}

export async function createOrUpdatePr(
  worktreePath: string,
  opts: {
    title: string;
    body?: string;
    base: string;
    head: string;
    draft?: boolean;
    /** Open the GitHub PR form in the browser instead of creating via API. */
    web?: boolean;
    /** Login to assign, `@me` (default), or none/unassigned to skip. */
    assignee?: string | null;
  },
): Promise<string> {
  const origin = await resolveOriginRemote(worktreePath);
  if (origin?.forge === 'entire') throw entireUsesTrails();
  const cursorSlug = origin?.forge === 'cursor' ? origin.slug : null;
  if (cursorSlug) return createCursorPullRequest(worktreePath, cursorSlug, opts);
  // Prefer origin over `gh`'s inferred repo — Makerkit-style checkouts with
  // origin + upstream otherwise create PRs against the template upstream.
  await ensureGhPreferOrigin(worktreePath);
  const slug = await resolveGithubRepoSlug(worktreePath);
  if (!slug) {
    throw new Error(
      'Could not resolve the origin GitHub repo (owner/name) for this worktree. ' +
        'Check that `git remote get-url origin` points at github.com.',
    );
  }
  const repoArgs = ghRepoSelectArgs(slug);
  const headRef = ghHeadRef(slug, opts.head);
  const branchOnly = opts.head.trim().replace(/^refs\/heads\//, '');
  const bodyText = clampGithubPrBody(opts.body ?? opts.title);
  const bodyFile = join(
    tmpdir(),
    `sideboard-pr-body-${process.pid}-${randomBytes(6).toString('hex')}.md`,
  );
  writeFileSync(bodyFile, bodyText.endsWith('\n') ? bodyText : `${bodyText}\n`, 'utf8');
  const bodyArgs = ['--body-file', bodyFile];

  try {
    return await createOrUpdatePrWithBodyFile(worktreePath, {
      ...opts,
      slug,
      repoArgs,
      headRef,
      branchOnly,
      bodyArgs,
    });
  } finally {
    try {
      unlinkSync(bodyFile);
    } catch {
      // temp file
    }
  }
}

async function createOrUpdatePrWithBodyFile(
  worktreePath: string,
  opts: {
    title: string;
    base: string;
    head: string;
    draft?: boolean;
    web?: boolean;
    assignee?: string | null;
    slug: string;
    repoArgs: string[];
    headRef: string;
    branchOnly: string;
    bodyArgs: string[];
  },
): Promise<string> {
  const { slug, repoArgs, headRef, branchOnly, bodyArgs } = opts;

  const existing = await gh(
    [...repoArgs, 'pr', 'view', branchOnly, '--json', 'url', '--jq', '.url'],
    worktreePath,
    { reject: false },
  );
  if (existing.exitCode === 0 && existing.stdout.trim() && !opts.web) {
    const url = existing.stdout.trim();
    // Refresh title/body from the latest change purpose (not the thread nickname).
    await gh(
      [
        ...repoArgs,
        'pr',
        'edit',
        branchOnly,
        '--title',
        opts.title,
        ...bodyArgs,
      ],
      worktreePath,
      { reject: false },
    );
    return url;
  }

  if (opts.web) {
    const args = [
      ...repoArgs,
      'pr',
      'create',
      '--web',
      '--title',
      opts.title,
      ...bodyArgs,
      '--base',
      opts.base,
      '--head',
      headRef,
    ];
    if (opts.draft) args.push('--draft');
    args.push(...ghPrCreateAssigneeArgs(opts.assignee));
    await gh(args, worktreePath, { reject: false });
    // URL may open in browser; return existing view if available
    const again = await gh(
      [...repoArgs, 'pr', 'view', branchOnly, '--json', 'url', '--jq', '.url'],
      worktreePath,
      { reject: false },
    );
    return again.stdout.trim() || '';
  }

  const args = [
    ...repoArgs,
    'pr',
    'create',
    '--title',
    opts.title,
    ...bodyArgs,
    '--base',
    opts.base,
    '--head',
    headRef,
  ];
  if (opts.draft) args.push('--draft');
  args.push(...ghPrCreateAssigneeArgs(opts.assignee));
  const created = await gh(args, worktreePath, { reject: false });
  if (created.exitCode !== 0) {
    const raw =
      created.stderr.trim() ||
      created.stdout.trim() ||
      'gh pr create failed';
    throw new Error(await formatPrCreateFailure(raw, worktreePath, { slug, head: headRef }));
  }
  const url =
    created.stdout.trim().split('\n').find((l) => l.startsWith('http')) ??
    created.stdout.trim();
  return url;
}
