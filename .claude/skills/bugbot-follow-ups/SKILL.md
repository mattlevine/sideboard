---
name: bugbot-follow-ups
description: >-
  Address Cursor Bugbot review comments on recent PRs. Use when the user asks
  to fix cursor bot / Bugbot notes, leftover review comments, or follow-ups
  from merged PRs. One follow-up PR; do not reopen the originals.
---

# Bugbot follow-ups

Recent PRs are often already merged. Collect leftover Cursor Bugbot notes and
land them on a new branch from current `origin/main`. Do not push the
placeholder thread branch.

## Collect

From this worktree, against **origin** (`mattlevine/sideboard`):

```bash
gh pr list -R mattlevine/sideboard --state all --limit 20 \
  --json number,title,url,state,updatedAt
```

For each recent non-release PR, pull review comments whose login matches
`cursor` / `bugbot`:

```bash
gh api "repos/mattlevine/sideboard/pulls/<n>/comments" \
  --jq '.[] | select(.user.login | test("cursor|bugbot"; "i")) | {path,line,body}'
```

Skip comments that a later commit or PR already fixed (read current `main`).
Skip nits that do not match a real caller or test.

## Fix

- One follow-up PR covering the leftover notes (see #91).
- Match existing helpers and tests; add a regression test per accepted note.
- Prefer the function Bugbot named (empty allowlist, pagination, unknown
  viewer) over drive-by refactors.
- Stay on the thread worktree. Draft PR: `gh pr create --draft -R mattlevine/sideboard`.

## Do not

- Reopen or comment on the merged PR unless the user asked to post.
- Force-push or merge locally into the main checkout.
- Treat Bugbot as always right — verify against callers and tests first.
