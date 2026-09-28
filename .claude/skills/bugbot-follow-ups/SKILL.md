---
name: bugbot-follow-ups
description: >-
  Check recently merged PRs for un-addressed Cursor Bugbot / cursorbot
  review comments and land the leftover fixes. Use when the user asks to
  sweep cursor bot notes, leftover Bugbot comments, unresolved review
  threads after merge, or follow-ups from merged PRs. One follow-up PR;
  do not reopen the originals.
---

# Bugbot / cursorbot follow-ups

Recent PRs are often already merged while Cursor Bugbot (`cursor` /
`cursor[bot]`) threads stay **unresolved**. Collect those notes, triage
against current `origin/main`, and land accepted fixes on a **new** branch
from main. Do not push the placeholder thread branch.

Trigger phrases: leftover Bugbot, cursorbot comments, un-addressed review
comments on merged PRs, sweep recent merges for cursor bot.

## Collect

Source of truth is GraphQL **review threads** (`isResolved`), not REST
`/pulls/{n}/comments` (no resolved flag) and not Sideboard
`github_get_issue` (crushes comment bodies).

From this worktree, against **origin** (`gh repo view` / `-R mattlevine/sideboard`):

```bash
.claude/skills/bugbot-follow-ups/collect.sh 20
```

That writes compact JSON to `.context/cli/bugbot-follow-ups.json` and prints
one line (`N unresolved cursorbot notes in M PRs → …`). Raise the limit only
if the window is empty; past ~40 PRs detach (`/long-running`).

Do **not** paste `gh api` / `--json` / GraphQL payloads into a tool result.
Read a slice of the file instead.

Manual equivalent (one PR, after skipping `Release *` titles):

```bash
gh api graphql -f query='
query($owner:String!,$name:String!,$n:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$n) {
      reviewThreads(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          comments(first: 20) {
            nodes { author { login } body url createdAt }
          }
        }
      }
    }
  }
}' -F owner=mattlevine -F name=sideboard -F n=<n>
```

Keep threads where `isResolved == false` and any comment author matches
`cursor` / `bugbot` (GraphQL login `cursor`; REST login `cursor[bot]`).
Paginate while `pageInfo.hasNextPage`. Default window: last **20** merged
PRs. Skip release-cut PRs (`title` starts with `Release `).

Un-addressed means **unresolved thread**, not “no reply.” A merged PR can
leave every Bugbot thread open even when a later commit already fixed it.

## Triage

Write the queue to `.context/cli/bugbot-follow-ups-triage.md` (pending vs
accept vs skip). Rebuild that file if the turn dies mid-sweep.

For each note:

1. Open `commentUrl` / `preview` and the cited `path` on **current
   `origin/main`** (fetch first). `outdated: true` is not a skip by itself.
2. **Already fixed** — skip. Later PR or commit on main already has the
   behavior. Do not churn.
3. **Human dismissed** — skip when `replyLogins` includes a clear
   won’t-fix / false-positive / “fixed in #N” (not a drive-by emoji).
4. **Nit / wrong** — skip. Bugbot is not always right. Verify against
   callers and tests. Skip notes that do not match a real caller, that
   demand rigor the rest of the file does not have, or that are style-only.
5. **Accept** — still broken on main, discrete, and the author would have
   fixed it. Prefer the function / helper Bugbot named.

Do not “fix” by resolving the GitHub thread. Do not comment on the merged
PR unless the user asked to post.

## Fix

- One follow-up PR covering the accepted notes (see #91, #178).
- Branch from current `origin/main` on this worktree
  (`matt/…-bugbot-follow-ups-…`). Match existing helpers; add a regression
  test per accepted note.
- If the miss will recur, add one sentence to
  [`.claude/skills/review/SKILL.md`](../review/SKILL.md) in the same change.
  Do not patch around the rulebook.
- Stay on this worktree. Draft PR:
  `gh pr create --draft --assignee @me -R mattlevine/sideboard`.

## Do not

- Reopen, review-reply, or resolve threads on the merged PR unless the
  user asked to post.
- Force-push or merge locally into the main checkout.
- Open one PR per leftover note.
- Treat Bugbot as always right.
- Dump full thread JSON into chat (`.context/cli/` only).
- Scan unmerged PRs unless the user named them — this skill is the
  **merged** leftover sweep.
