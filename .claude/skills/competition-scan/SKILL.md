---
name: competition-scan
description: >-
  Daily what-to-do-today scan of products in Sideboard's space. Competition
  informs docs/ROADMAP.md. The one recommendation is the unfinished Now or
  Next item a dated peer fact makes the right next step, or a marketing or
  prior-call change. Reinforcing a Now or Next item is a recommendation, not
  a quiet day. When there is one recommendation, queue it and ask before any
  worktree. Use when the competition-scan automation fires, or when someone
  asks for a competitive scan. The report stays in the chat. Do not open a
  pull request from the scan chat.
---

# Competition scan

One report per run: what to do today. Competition informs `docs/ROADMAP.md`. The recommendation is the unfinished Now or Next item a dated peer fact makes the right next step, or a marketing or prior-call change. Name the item, for example "Now item 1: Put the phone app in people's hands." At most one recommendation.

Reinforcing an unfinished Now or Next item is a recommendation. A quiet day is only when no dated peer fact makes any roadmap item, marketing change, or prior-call change the right next step. Do not call the day quiet because that item was already first on Now. Do not end the report with "the set is unchanged" when a dated peer fact reinforces work already on the roadmap.

## When

The local automation fires this in a new Global chat, or a person asks for a competitive scan. Do the scan in that turn. Do not create another schedule.

## Read first

1. `~/.sideboard/competition-scan.md`. Prior calls and past reports. A line in the log is the last answer, not a ban. When the log has a line for a call, that line replaces the same dated line in this skill. Create the file if it is missing, with the prior calls below copied to the top. Copy a seed line only when the log has no line for that call.
2. The pitch and the compare notes on the default branch the Approve child will edit (`origin/main`, or that project's default branch). `git fetch origin`, then read each file with `git show origin/main:<path>`:
   - `README.md` through "Why it exists"
   - `site/index.html` (the homepage)
   - `docs/COMPARE.md`, `site/docs/_src/compare.md`, and `site/docs/compare/index.html`. The two markdown files carry the same facts and different links. When they disagree with each other or with the published HTML, say so in the report.
   - `docs/ROADMAP.md`. Read Now, Next, Later, Not building, Decided, and Open decisions.
   Quote that tree. Do not quote a worktree that is not that branch, including the checkout that holds this skill. Leave the main repo checkout unedited. When `site/docs/_src/compare.md` is missing on that branch, say so. Do not invent the file.
3. `list_schedules`. Find this automation and the previous run's chat id. `get_chat` on that id is a preview. The log file is the record.

`list_projects` names the Sideboard repo for a later `create_workspace`. Do not read the pitch from whichever worktree happens to contain this skill.

## Who

Start from the peers named in the compare notes: Conductor, Orca (an agent IDE with an embedded editor, the orchestration CLI, and Orca Bots), Superset / Paradev, the Codex app remote, Claude Code Remote Control, Multica, and local worktree-board clones.

Also look for a product that appeared since the last log entry and does the same job: a fleet of Claude Code, Codex, Cursor, or OpenCode, on git worktrees, with a board, a phone, or a way for another agent to drive the fleet.

Search the open web. Prefer a primary source with a date: changelog, release notes, docs, or a founder post. Skip undated roundups and pages that only restate a homepage.

## Judge

Sideboard today is an agent IDE whose wedge is the orchestration tier: a file editor, a terminal, and a URL preview on the desktop, a kanban of the fleet, an orchestrator MCP, and remotes (phone, CLI, MCP), without design mode, an embedded browser, or moving compute off this machine. The checkout is the unit. One orchestrator on this Mac can see every chat. The phone is the remote. Slack is collaboration. Skills live in the repo. Compute stays on this Mac. `attach` returns to the harness session. A peer that centers an embedded terminal, browser, or design mode is an ADE in the same category. Do not treat "agent IDE" as a label that belongs only to Orca. Do not write that Sideboard is not an IDE, and do not write that the file editor, the terminal, or the URL preview is absent. That description is the current shape. A recommendation may move it.

Recommend at most one change. Competition informs `docs/ROADMAP.md`. Prefer naming an unfinished Now or Next item when a dated peer change reinforces it. That is a recommendation, not a quiet day. Name the item, for example "Now item 1: Put the phone app in people's hands." Do not call the day quiet because the item was already first on Now. The other allowed recommendation is a marketing change, or a change to a prior call, that the same kind of dated fact makes the right next step.

A Decided item under Now or Next can still be that recommendation. Do not reopen the decision. Do not recommend work listed under Not building. Leave Later and Open decisions in place unless the new fact makes that line the wrong product — then the recommendation is a change to that roadmap line, not a new direction.

Leave a prior call in place when nothing new makes it the right change. Change it when the peer, the product, the pitch, or the roadmap has moved, or when the old answer is now the wrong product. Name the old call and why it should move.

A quiet day is only when no dated peer fact makes any roadmap item, or any marketing or prior-call change, the right next step.

A product recommendation names the unfinished Now or Next item it advances (for example, "Now item 1: Put the phone app in people's hands"), the surface (board, orchestrator, phone, Slack, or skills), the dated peer fact that prompted it, and the URL when there is one. Naming that item is the recommendation, including when it was already first on Now. When the change is the roadmap line itself, include `docs/ROADMAP.md` in `files`.

A marketing recommendation names the file (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, or `site/docs/compare/index.html`), quotes the sentence from the default branch, and writes the replacement. When compare copy changes, name all three compare paths, including the published HTML. When the sentence is a public category claim, also name `docs/brand/content-brand-guide.md` (Category, required terms, and claim 11). It qualifies when that sentence is false, or when it is still true and the positioning is stale — the sentence tells the wrong story about this shape. Include the fact that prompted it and the URL when there is one.

Prior calls are the lines in the log. The dated list at the bottom of this skill is only the seed for a missing line. Do not treat a seed line as current when the log has a newer line for that call.

## Report

Write the report in the chat, in this order:

- **Changed.** Product, what shipped, date, and URL. Leave out anything you cannot date or source.
- **New name.** A product missing from the compare notes. One sentence on its shape, and whether the notes should name it.
- **Recommendation.** Zero or one. Prefer an unfinished Now or Next item a dated peer fact reinforces, and name it (for example, "Now item 1: Put the phone app in people's hands"). That naming is the recommendation. Also allowed: marketing copy (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, `site/docs/compare/index.html`), a change to a Later or Open roadmap line the fact makes wrong, or a change to a prior call. For marketing, name the file, quote the sentence, and write the replacement. For a prior call, name the old call and why it should move. A stale true sentence qualifies. A quiet day is only when no dated peer fact makes any of those the right next step. Write that. Do not write that the set is unchanged because peers reinforce an item already on Now.
- **Compare notes.** Use this only when the recommendation is a product change and a compare sentence is also false or stale. Quote it and write the replacement. Name `docs/COMPARE.md`, `site/docs/_src/compare.md`, and `site/docs/compare/index.html`. When the one recommendation is itself that wording change, it belongs under Recommendation.

Append the same report under today's date in `~/.sideboard/competition-scan.md`. Keep prior calls at the top. A recommendation that would change a prior call describes the old line and the proposed line in that day's report only. Do not rewrite the prior-call line until Approve. On Skip or Defer, leave that line as it was. If this run already wrote a provisional line, restore the previous wording before you stop. The rewritten line, once Approve has written it, replaces the seed in this skill on the next run. Do not edit this skill to move a call. Do not commit the log.

Do not edit the compare notes, the README, the homepage, the roadmap, or this skill in the scan turn. Implementation is a separate Approve worktree. Do not open a pull request from the scan chat.

## Queue

After the chat report and the log append, when the report has exactly one Recommendation, upsert one row in `~/.sideboard/competition-scan-queue.json`. Create the file when it is missing, as `{ "items": [] }`. A recommendation that names an unfinished Now or Next item is one recommendation, so it adds a row. A quiet day adds no row.

```json
{
  "items": [
    {
      "id": "2026-11-24-marketing-stop-denying-ide",
      "date": "2026-11-24",
      "kind": "marketing",
      "summary": "Stop denying IDE in the compare notes and homepage.",
      "files": ["docs/COMPARE.md", "site/docs/_src/compare.md", "site/docs/compare/index.html", "site/index.html"],
      "quote": "The sentence to replace.",
      "replacement": "The sentence to ship.",
      "url": "https://example.com/source",
      "status": "pending"
    }
  ]
}
```

`kind` is `product`, `marketing`, or `prior-call`. An unfinished Now or Next item is `product`: `summary` names the item, and `quote` is that roadmap line. `files` lists the repo paths the recommendation named (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, `site/docs/compare/index.html`, `docs/brand/content-brand-guide.md`, `docs/ROADMAP.md`), or `[]` only when a prior call names none. When compare copy changes, include `site/docs/compare/index.html` with the two markdown files. `quote` is the sentence, the roadmap line, or the old prior call, taken from the default branch. `replacement` is the new wording or the new call. For a Now or Next item the child should do, `replacement` restates the item and the dated peer fact. `url` is the dated source, or `""` when there is none. `status` is `pending`, `approved`, `skipped`, `deferred`, or `shipped`.

`id` is `YYYY-MM-DD-<kind>-<slug>`. The slug is a few kebab-case words from the summary, and the same recommendation on the same day keeps the same id. Upsert that id. When the row is `pending`, refresh the fields and leave the status. When the row is already `approved`, `skipped`, `deferred`, or `shipped`, leave it. A different recommendation is a new row. Do not commit the queue.

## Ask

When this run appended or refreshed a `pending` row, explain the recommendation in a few sentences in the chat, then call `ask_user` with three options:

- **Approve** — implement in a worktree and open a draft PR
- **Skip**
- **Defer**

Then stop. Do not `create_workspace` before the person answers. A recommendation that names an unfinished Now or Next item still calls `ask_user`. A quiet day does not call `ask_user`. A row that was already decided does not call `ask_user` again.

This Global chat is the orchestrator. There is no named bot and no second orchestrator. The schedule text lives in the local automation, not in this repo. The next run follows this skill. Do not edit `~/Library/Application Support/sideboard/schedules.json` from a worktree.

When the person answers:

- **Approve.** When the recommendation is a prior call, this is the first moment that line may change. Rewrite it in `~/.sideboard/competition-scan.md` to the proposed wording, and keep the old wording under today's report. When the recommendation is a prior call and `files` is empty, set the row to `shipped` and stop. There is no pull request. When `files` is not empty, or when `kind` is `product` or `marketing`, set the row to `approved`. `list_projects`, then `create_workspace` on the Sideboard repo from `main` (`sourceType` `branch`, `sourceRef` `main`, `repoPath` from that project, `title` from the summary). `create_workspace` takes no prompt. `send_to_chat` on the new chat with a tight prompt from the row: kind, summary, files, quote, replacement, and url. The child implements only that change. When `site/docs/compare/index.html` is in `files`, edit that HTML by hand so it matches the markdown. Do not run `scripts/render-site-docs.py`. It strips the live chrome. The child opens a draft PR (`gh pr create --draft --assignee @me -R mattlevine/sideboard`) and does not merge. Loop `wait_for_turn` until `stillRunning` is false. Set the row to `shipped` only when a draft PR URL is back. When the child fails or returns no PR URL, set the row back to `pending` so a later run can ask again.
- **Skip.** Set the row to `skipped`. Leave every prior-call line unchanged. If a provisional line was written, restore the previous wording. Stop.
- **Defer.** Set the row to `deferred`. Leave every prior-call line unchanged. If a provisional line was written, restore the previous wording. Stop.

Never merge that PR unless a person asks. The scan chat does not open the PR. Do not post to X from the scan turn, and do not post before the pull request is merged.

## After merge

Approve, then the child implements and opens a draft PR. A person, or this orchestrator when a person has asked, merges. The scan chat does not merge.

When that merged pull request changed `site/`, deploy the marketing site from the repo root before the post. Follow [`.claude/skills/release/SKILL.md`](../release/SKILL.md): `fly deploy --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile .`. Details are in [docs/system/deploy.md](../../../docs/system/deploy.md). Skip the deploy when `site/` did not change.

After the merge, and after that deploy when `site/` changed, follow [`.claude/skills/announce-on-x/SKILL.md`](../announce-on-x/SKILL.md) for that pull request. The account is `@sideboard_build`. The poster dedupes in `~/.sideboard/x-announced.json`. One post or a recorded skip. Do not schedule a later job.

A change to the public homepage or compare story is something a reader can see, so a short positioning note qualifies. announce-on-x skips a merge a reader would not notice: dependency bumps, CI, formatting, review nits, or a release whose notes were already posted. When those skip criteria apply, skip and record the reason. Do not override that skip. "Wording-only" is not itself a reason to skip when the public homepage or compare story changed, and it is not a reason to post when announce-on-x would skip.

## Prior calls

Keep this block at the top of `~/.sideboard/competition-scan.md`, one call per line. Copy a line only when the log has no line for that call. A newer line in the log replaces the same call here.

Orca Bots (beta, [v1.4.265](https://orca.dev/changelog/1-4-265), November 19, 2026) are a named folder on one computer: soul, memory, one harness. Slack, Linear, GitHub, Gmail, Calendar, and webhooks start runs. Code goes to a child worktree. Orca Cloud holds the inbound request until the computer takes it.

- 2026-11-24 — Sideboard keeps a single orchestrator.
- 2026-11-24 — One Needs you list across the board.
- 2026-11-24 — A reply in the thread that asked. A mention wakes the orchestrator with a note. It does not start a workspace.
- 2026-11-24 — Playbooks live as skills plus a schedule.
- 2026-11-24 — A named bot with its own soul, as a second identity beside the orchestrator, stayed out.
- 2026-11-24 — A Slack app per bot, and teammates whose requests run as the person at this Mac, stayed out.
- 2026-11-24 — Gmail, calendar, or a general connector catalog on the orchestrator, stayed out.
- 2026-11-24 — Bot groups across computers stayed out.
- 2026-11-24 — Memory the agent rewrites on its own stayed out.
- 2026-11-24 — Design mode, computer use, or a mobile emulator stayed out. The desktop already has a file editor, a terminal, and a URL preview. `attach` returns to the harness session.
