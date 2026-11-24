---
name: announce-on-x
description: >-
  Post a ship note to @sideboard_build on X when a Sideboard pull request
  merges. Read the PR and the content brand guide, then write the text and
  an optional image. Use after a merge, or when catching merges that have
  not been announced.
---

# Announce a merged PR on X

Post to [@sideboard_build](https://x.com/sideboard_build) when a pull request merges to the default branch of `mattlevine/sideboard`. One post, or a recorded skip. Do not ask first. Do not announce any other repo.

The account keys `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are already in the environment (Settings → Environment, account scope). Do not print them, pass them on a command line, or copy them into the repo.

## When

- You just merged a pull request to the default branch. Announce that PR before the turn ends.
- A schedule or a person asks you to catch merges. Announce pull requests merged after the ledger's `since`, and leave older ones alone. The first run only records `since`. It does not backfill.

## Read

1. [docs/brand/content-brand-guide.md](../../../docs/brand/content-brand-guide.md). For a post, use the voice (section 3), the terms (section 4), the claims ledger (section 5), and the launch-note row in section 7. The six-page site arc does not apply.
2. The pull request: `gh pr view <n> -R mattlevine/sideboard --json title,body,mergedAt,baseRefName,state,url,files`. Confirm `state` is `MERGED` and `baseRefName` is the default branch. Read the diff only far enough to say what a developer can now do, see, or trust. `gh pr diff <n> -R mattlevine/sideboard --name-only` is enough when the body already says it.

Leave out anything the diff does not show. Leave out numbers, testimonials, certifications, and "the only" unless section 5 already allows that sentence and this PR is that fact. Do not put tokens, customer data, or internal hostnames in the post.

## Write

One or two short sentences. What changed, as a fact. Address the reader as "you" when you address anyone. Sideboard is third person and capitalised. Sentence case. No exclamation marks, emoji, or reassurance ("rest easy", "totally safe", "don't worry"). The launch-note shape is the model: "Sideboard now runs against VPN-only APIs with nothing uploaded." Do not reuse that sentence unless this PR is that change.

The poster appends the pull request URL and counts it as 23 characters. Keep your text at or under 240 characters so the link fits.

## Image

Attach an image only when the change is easier to see than to read. Prefer a real screenshot of this product (a file in the PR, or a capture of the running app). Do not invent a fake screen of Sideboard.

If you cannot capture it and a still would carry the same sentence, generate one image: dark ground, that one sentence, sentence case, no extra claim. Save it under `.context/cli/` and pass `--image`. If the upload fails, post the text without the image.

## Send

From the repo root. The script checks the token is `@sideboard_build`, refuses a second post for the same PR, and writes `~/.sideboard/x-announced.json`. Exit code 3 means another announce holds the lock. Leave that run alone. A later catch-up records the same PR from the ledger or the timeline.

```sh
node .claude/skills/announce-on-x/post.mjs post --pr <n> --text "<text>"
node .claude/skills/announce-on-x/post.mjs post --pr <n> --text "<text>" --image .context/cli/<file>.png
```

A skip is for a merge a reader would not notice: dependency-only bumps, CI, formatting, review nits, or a release PR whose user-visible notes were already posted with their own pull requests. Say why in a few words.

```sh
node .claude/skills/announce-on-x/post.mjs skip --pr <n> --reason "ci only"
```

Do not skip a change to what a developer can do, see, or trust.

## Catch-up

If you merged a PR in this turn, announce that PR before `init`. `init` freezes `since`, and a PR merged a moment earlier would otherwise look like history.

```sh
node .claude/skills/announce-on-x/post.mjs status
node .claude/skills/announce-on-x/post.mjs init
```

`init` sets `since` the first time and does nothing after that. Then:

```sh
gh pr list -R mattlevine/sideboard --state merged --limit 20 --json number,title,mergedAt,url
```

For each PR with `mergedAt` after `since` and no ledger row, announce it or skip it. Cap a run at five posts. Leave the rest for the next run. Do not edit the git checkout to do this.
