---
name: announce-on-x
description: >-
  Post a ship note to @sideboard_build on X when a Sideboard pull request
  merges. Read the PR and the content brand guide, then write the text and
  an optional image. Use in the same turn as the merge. Do not schedule a
  catch-up.
---

# Announce a merged PR on X

Post to [@sideboard_build](https://x.com/sideboard_build) when a pull request merges to the default branch of `mattlevine/sideboard`. One post per pull request, or a recorded skip. Do not ask first. Do not announce any other repo.

The account keys `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are already in the environment (Settings → Environment, account scope). Do not print them, pass them on a command line, or copy them into the repo.

## When

You just merged onto the default branch. Before the turn ends, post or skip each pull request that merge landed. A stack merge can land more than this thread's pull request. Do not schedule a later job.

## Read

1. [docs/brand/content-brand-guide.md](../../../docs/brand/content-brand-guide.md). For a post, use the voice (section 3), the terms (section 4), the claims ledger (section 5), and the launch-note row in section 7. The six-page site arc does not apply.
2. The pull request: `gh pr view <n> -R mattlevine/sideboard --json title,body,mergedAt,baseRefName,state,url,files`. Confirm `state` is `MERGED` and `baseRefName` is the default branch. Read the diff only far enough to say what a developer can now do, see, or trust. `gh pr diff <n> -R mattlevine/sideboard --name-only` is enough when the body already says it.

Leave out anything the diff does not show. Leave out numbers, testimonials, certifications, and "the only" unless section 5 already allows that sentence and this PR is that fact. Do not put tokens, customer data, or internal hostnames in the post.

## Write

One or two short sentences about what this pull request changed. A standing description of Sideboard is not the note. Address the reader as "you" when you address anyone. Sideboard is third person and capitalised. Sentence case. No exclamation marks, emoji, or reassurance ("rest easy", "totally safe", "don't worry"). The launch-note shape is the model: "Sideboard now runs against VPN-only APIs with nothing uploaded." Do not reuse that sentence unless this PR is that change.

No need to include a link. Leave out the pull request URL and sideboard.build. The account profile already points at the site, and the same link on every post would attach the same preview card. The poster sends the text as written. Keep it at or under 280 characters.

Sideboard is an agent IDE whose wedge is the orchestration tier. When a post names what Sideboard is, say that, so the note can be found as an agent IDE. The shape is the checkout, the board, and the orchestrator on this Mac. Do not write that Sideboard is not an IDE. Do not write that it has no editor, terminal, or browser. The desktop has a file editor, a terminal, and a URL preview, and `attach` returns to the harness session. Name the topic that was being worked on. A tag is only when the note is about that category. Leave the tag off a note that does not name it.

## Image

Attach an image only when the change is easier to see than to read. Prefer a real screenshot of this product (a file in the PR, or a capture of the running app). Do not invent a fake screen of Sideboard.

If you cannot capture it and a still would carry the same sentence, generate one image: dark ground, that one sentence, sentence case, no extra claim. Save it under `.context/cli/` and pass `--image`. If the upload fails, post the text without the image.

## Send

From the repo root. The script checks the token is `@sideboard_build`, refuses a second post for the same PR, and writes `~/.sideboard/x-announced.json`. Exit code 3 means another announce holds the lock. Retry this PR in this turn after it clears. Do not schedule a later job.

```sh
node .claude/skills/announce-on-x/post.mjs post --pr <n> --text "<text>"
node .claude/skills/announce-on-x/post.mjs post --pr <n> --text "<text>" --image .context/cli/<file>.png
```

A skip is for a merge a reader would not notice: dependency-only bumps, CI, formatting, review nits, or a release PR whose user-visible notes were already posted with their own pull requests. Say why in a few words.

```sh
node .claude/skills/announce-on-x/post.mjs skip --pr <n> --reason "ci only"
```

Do not skip a change to what a developer can do, see, or trust.
