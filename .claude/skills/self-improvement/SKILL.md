---
name: self-improvement
description: >-
  Daily self-improvement loop for Sideboard. docs/ROADMAP.md is the default
  order. Change a line when it is not the best path, given how the code and
  the UI are implemented today. UI conventions and coding conventions can
  change the same way. The competition scan informs that judgment. Each
  run starts from the last queue outcome and names one undone slice of the
  unfinished Now item, then Next, when that slice is still the best next
  step. Otherwise the one recommendation is a change to the roadmap line, or
  to a UI or coding convention that is in the way. A dated peer fact can
  point the same way. A missing peer fact is not a quiet day while an open
  slice remains the best path. A skipped or deferred slice stays out until a
  new fact makes that outcome the wrong product. The loop then takes the next
  open slice when it is still the best path. A product row names the slice
  and the repo paths it edits. Do not queue a product row with no slice. A
  convention row (`kind: convention`) names the current behavior, the better
  behavior, and the paths. Do not queue a convention row with empty files. When there is one recommendation, queue it and ask
  before any worktree. Use when the self-improvement automation fires, or
  when someone asks for the daily loop. The report stays in the chat. Do
  not open a pull request from this chat.
---

# Self-improvement

The main thing is the self-improvement loop. `docs/ROADMAP.md` is the default order. Change it when that order is not the best path to make Sideboard as successful as it can be. Judge that from how the code and the UI are implemented today, and from the competition scan. A UI convention or a coding convention can change when keeping it is not the best path.

Each run starts from the last queue outcome, reads Now then Next on the default branch, and reads how the code and the UI are implemented. It recommends one undone slice of the first unfinished item that is still the best next step. When that item is not the best path, the one recommendation is a change to the roadmap line: what to rewrite, reorder, or drop, and the better next step. A dated peer fact can point at a different item, or make a marketing change or a prior-call change the one recommendation instead. A day with no new peer fact still recommends the next open slice when that slice is the best path. A skipped or deferred slice stays out until a new fact makes that outcome the wrong product. The loop then takes the next open slice, a roadmap change when that slice is the wrong path, or a change to a UI or coding convention when that convention is in the way.

Name the item and the slice. For "Now item 1: Put the phone app in people's hands," a slice might be "EAS TestFlight build + install links on `site/index.html` and Settings → Remote," not "ship iOS and Android forever." At most one recommendation.

A quiet day is when no open slice is the best path and no roadmap, marketing, prior-call, or convention change is the better next step. Do not call the day quiet because no peer shipped anything. Do not call it quiet because an open item was already first on Now. Do not end the report with "the set is unchanged" when an open roadmap slice remains the best path, or when the roadmap line itself should change.

## When

The local automation fires this in a new Global chat, or a person asks for the daily loop. Do the loop in that turn. Do not create another schedule.

## Read first

1. `~/.sideboard/self-improvement-queue.json`, then `~/.sideboard/self-improvement.md`. Before creating either file, rename each missing pair: `~/.sideboard/competition-scan-queue.json` to `~/.sideboard/self-improvement-queue.json`, and `~/.sideboard/competition-scan.md` to `~/.sideboard/self-improvement.md`. Do not keep two logs. Do not create a new file while its old name still exists. The queue is where the loop left off. Any `pending` row is still the open recommendation: refresh it, and do not add another. Any `approved` row with no pull request is still in flight: do not start another slice. A `shipped`, `skipped`, or `deferred` row is closed. Do not recommend that slice again. A skipped or deferred slice stays out until a new dated fact makes that outcome the wrong product. The loop then takes the next open slice when that slice is still the best path, a roadmap change when that slice is the wrong path, or a change to a UI or coding convention when that convention is in the way. The log holds prior calls and past reports. A line in the log is the last answer, not a ban. When the log has a line for a call, that line replaces the same dated line in this skill. Create the log if it is missing, with the prior calls below copied to the top. Copy a seed line only when the log has no line for that call. Create the queue if it is missing, as `{ "items": [] }`.
2. The pitch and the compare notes on the default branch the Approve child will edit (`origin/main`, or that project's default branch). `git fetch origin`, then read each file with `git show origin/main:<path>`:
   - `README.md` through "Why it exists"
   - `site/index.html` (the homepage)
   - `docs/COMPARE.md`, `site/docs/_src/compare.md`, and `site/docs/compare/index.html`. The two markdown files carry the same facts and different links. When they disagree with each other or with the published HTML, say so in the report.
   - `docs/ROADMAP.md`. Read Now, Next, Later, Not building, Decided, and Open decisions.
   - How Sideboard is implemented today, in the code and in the UI. Code: the package table and "Data flow (short)" in `docs/system/architecture.md`, and the coding conventions in `docs/system/conventions.md`. UI: `apps/desktop/src/renderer/src/App.tsx` (the board) and `apps/mobile/App.tsx` (the phone), including the conventions those screens follow. Read the surfaces the next slice would touch. The roadmap is the plan. These files are the implementation.
   Quote that tree. Do not quote a worktree that is not that branch, including the checkout that holds this skill. Leave the main repo checkout unedited. When `site/docs/_src/compare.md` is missing on that branch, say so. Do not invent the file.
3. `list_schedules`. Find this automation and the previous run's chat id. `get_chat` on that id is a preview. The log file is the record.

`list_projects` names the Sideboard repo for a later `create_workspace`. Do not read the pitch from whichever worktree happens to contain this skill.

## Who

Start from the peers named in the compare notes: Conductor, Orca (an agent IDE with an embedded editor, the orchestration CLI, and Orca Bots), Superset / Paradev, the Codex app remote, Claude Code Remote Control, Multica, and local worktree-board clones.

Also look for a product that appeared since the last log entry and does the same job: a fleet of Claude Code, Codex, Cursor, or OpenCode, on git worktrees, with a board, a phone, or a way for another agent to drive the fleet.

Search the open web. Prefer a primary source with a date: changelog, release notes, docs, or a founder post. Skip undated roundups and pages that only restate a homepage.

## Judge

Sideboard today is an agent IDE whose wedge is the orchestration tier: a file editor, a terminal, and a URL preview on the desktop, a kanban of the fleet, an orchestrator MCP, and remotes (phone, CLI, MCP), without design mode, an embedded browser, or moving compute off this machine. The checkout is the unit. One orchestrator on this Mac can see every chat. The phone is the remote. Slack is collaboration. Skills live in the repo. Compute stays on this Mac. `attach` returns to the harness session. A peer that centers an embedded terminal, browser, or design mode is an ADE in the same category. Do not treat "agent IDE" as a label that belongs only to Orca. Do not write that Sideboard is not an IDE, and do not write that the file editor, the terminal, or the URL preview is absent. That description is the current shape. A recommendation may move it.

Recommend at most one change to Sideboard. Start from the roadmap. Take the first unfinished Now item that still has an open slice, then Next, when that slice is the best next step given how the code and the UI are implemented today. Name the item, for example "Now item 1: Put the phone app in people's hands," and name one undone slice the child can finish in that worktree. The slice is the change, not the whole item. When that slice is not the best path to make Sideboard as successful as it can be, the one recommendation is a change to the roadmap line: what to rewrite, reorder, or drop, and the better next step. When a UI convention or a coding convention is what stands in the way, the one recommendation is `kind: convention`: the current behavior, the better behavior, and the paths. `docs/system/conventions.md` holds the coding conventions. The desktop board and the phone hold the UI conventions. A dated peer fact can support that call. It can also point the slice at a different unfinished Now or Next item, or make a marketing change or a prior-call change the one recommendation. A slice already `skipped` or `deferred` is not the change again until a new dated fact makes that outcome the wrong product. Recommend the next open slice when it is still the best path. Do not call the day quiet because no peer shipped today, or because an open item was already first on Now.

A Decided item under Now or Next can still be that recommendation. Leave a Decided, Later, Open, or Not building line in place when it is still the best path. Change it when keeping it is not the best path, given how the code and the UI are implemented and how successful Sideboard can be. The recommendation is then a change to that roadmap line: the old line, the new line, and why. It is still one change.

Leave a prior call in place when nothing new makes it the right change. Change it when the peer, the product, the pitch, or the roadmap has moved, or when the old answer is now the wrong product. Name the old call and why it should move.

A quiet day is when no open slice is the best path and no roadmap, marketing, prior-call, or convention change is the better next step. When the next open item has a slice and paths and that slice is the best path, that slice is the recommendation even if today's scan found nothing new. A marketing or prior-call change is the one recommendation when it is the better next step ahead of that slice. A roadmap-line change is the one recommendation when the next open slice is not the best path. A convention change is the one recommendation when a UI convention or a coding convention is in the way.

A product recommendation (`kind: product`) names one undone slice of an unfinished Now or Next item the child can finish in that worktree, not the whole multi-step item. Name the parent item, for example "Now item 1: Put the phone app in people's hands." For that item, a slice might be "EAS TestFlight build + install links on `site/index.html` and Settings → Remote," not "ship iOS and Android forever." Name the surface (board, orchestrator, phone, Slack, or skills). Name the dated peer fact and the URL when the scan supplied them. A missing peer fact does not block the slice. When the next slice is not the best path, this recommendation is the roadmap-line change instead, and `files` includes `docs/ROADMAP.md`. Naming that slice is the recommendation, including when the parent item was already first on Now. `files` lists the concrete repo paths that slice may edit, for example `apps/mobile`, `site/index.html`, and `apps/desktop/src/renderer/src/components/RemoteSettings.tsx`. Do not restrict `files` to marketing or roadmap docs. Include `docs/ROADMAP.md` only when the roadmap line itself changes. `replacement` states that slice, Done-when when the roadmap states one, and the dated peer fact when the scan supplied one. If this item has no landable slice and real paths, take the next open item that does. When none does, a marketing or prior-call change a dated fact makes right may be the recommendation. Otherwise the day is quiet. Do not queue a product row with no slice.

A convention recommendation (`kind: convention`) names one UI convention or coding convention that is in the way. `quote` is the current behavior. `replacement` is the better behavior. `files` lists the paths that hold it. Coding conventions live in `docs/system/conventions.md`. UI conventions live on the desktop board and the phone. Do not queue a convention row with empty `files`. It is still one change.

A marketing recommendation names the file (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, or `site/docs/compare/index.html`), quotes the sentence from the default branch, and writes the replacement. When compare copy changes, name all three compare paths, including the published HTML. When the sentence is a public category claim, also name `docs/brand/content-brand-guide.md` (Category, required terms, and claim 11). It qualifies when that sentence is false, or when it is still true and the positioning is stale — the sentence tells the wrong story about this shape. Include the fact that prompted it and the URL when there is one.

Prior calls are the lines in the log. The dated list at the bottom of this skill is only the seed for a missing line. Do not treat a seed line as current when the log has a newer line for that call.

## Report

Write the report in the chat, in this order:

- **Last outcome.** Every open queue row, then the newest closed row: status, summary, and whether this run may recommend it again. `pending` and `approved` stay the open loop. `shipped` is done. `skipped` and `deferred` stay out unless a new fact makes that outcome wrong. No rows yet means the loop is starting.
- **Changed.** Product, what shipped, date, and URL. Leave out anything you cannot date or source. These inform which roadmap item the loop picks. The recommendation is the change to Sideboard.
- **New name.** A product missing from the compare notes. One sentence on its shape, and whether the notes should name it.
- **Recommendation.** Zero or one. The default is one undone slice of the first unfinished Now item that is still the best next step, then Next, given how the code and the UI are implemented today. Name the item, the slice (for example, Now item 1 as "EAS TestFlight build + install links on `site/index.html` and Settings → Remote," not the whole item), and the repo paths. When that slice is not the best path to make Sideboard as successful as it can be, the recommendation is a change to the roadmap line: the old line, the new line, and why. When a UI convention or a coding convention is in the way, the recommendation is `kind: convention`: name the convention, the current behavior, the better behavior, and the paths. A dated peer fact can name a different Now or Next item, or replace the slice with marketing copy (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, `site/docs/compare/index.html`), a change to a Later, Open, Decided, or Not building line that is the wrong path, or a change to a prior call. For marketing, name the file, quote the sentence, and write the replacement. For a prior call, name the old call and why it should move. For a roadmap line, quote the old line and write the new one. A stale true sentence qualifies. A quiet day is when no open slice is the best path and no roadmap, marketing, prior-call, or convention change is the better next step. Write that. Do not write that the day is quiet because no peer shipped. Do not describe a product recommendation that has no slice. Do not describe a skipped or deferred slice as today's recommendation.
- **Compare notes.** Use this only when the recommendation is a product change and a compare sentence is also false or stale. Quote it and write the replacement. Name `docs/COMPARE.md`, `site/docs/_src/compare.md`, and `site/docs/compare/index.html`. When the one recommendation is itself that wording change, it belongs under Recommendation.

Append the same report under today's date in `~/.sideboard/self-improvement.md`. Keep prior calls at the top. A recommendation that would change a prior call describes the old line and the proposed line in that day's report only. Do not rewrite the prior-call line until Approve. On Skip or Defer, leave that line as it was. If this run already wrote a provisional line, restore the previous wording before you stop. The rewritten line, once Approve has written it, replaces the seed in this skill on the next run. Do not edit this skill to move a call. Do not commit the log.

Do not edit the compare notes, the README, the homepage, the roadmap, the conventions, or this skill in this turn. Implementation is a separate Approve worktree. Do not open a pull request from this chat.

## Queue

After the chat report and the log append, when the report has exactly one Recommendation, upsert one row in `~/.sideboard/self-improvement-queue.json`. Create the file when it is missing, as `{ "items": [] }`. A `product` recommendation that names one undone slice and concrete `files` is one recommendation, so it adds a row and still asks. Reinforcing an unfinished Now or Next item is that recommendation when the slice and paths are named. If this item has no slice with real paths, take the next open item that does. Do not add a product row that would open an empty worktree. When the next open slice is not the best path, the row is a change to `docs/ROADMAP.md`: the line to replace and the better next step. When a UI convention or a coding convention is in the way, the row is `kind: convention`: `quote` is the current behavior, `replacement` is the better behavior, and `files` lists the paths that hold it, including `docs/system/conventions.md` when a coding convention changes. Do not queue a convention row with empty `files`. When no open item has a slice, a marketing or prior-call change that is the better next step may be the row. Otherwise the day is quiet. A quiet day adds no row and does not ask. Do not upsert a new row for a slice that matches a `skipped` or `deferred` row unless this run's new fact makes that outcome the wrong product. A `pending` or `approved` row stays the one recommendation.

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
    },
    {
      "id": "2026-11-24-product-testflight-install-links",
      "date": "2026-11-24",
      "kind": "product",
      "summary": "Now item 1: EAS TestFlight build and install links.",
      "files": ["apps/mobile", "site/index.html", "apps/desktop/src/renderer/src/components/RemoteSettings.tsx"],
      "quote": "Put the phone app in people's hands.",
      "replacement": "Slice: EAS TestFlight build plus install links on the site phone section and Settings → Remote. Peer fact: the dated source. Done when: a new user pairs a phone without cloning the repo. Do not ship the App Store, Play, or the rest of item 1.",
      "url": "https://example.com/source",
      "status": "pending"
    },
    {
      "id": "2026-11-24-convention-board-density",
      "date": "2026-11-24",
      "kind": "convention",
      "summary": "Change the board density convention.",
      "files": ["apps/desktop/src/renderer/src/App.tsx"],
      "quote": "The current behavior on the board.",
      "replacement": "The better behavior, and why keeping the current one is not the best path.",
      "url": "",
      "status": "pending"
    }
  ]
}
```

`kind` is `product`, `marketing`, `convention`, or `prior-call`. An unfinished Now or Next item is `product` only when the row names one undone slice the child can finish in that worktree. `summary` for a product row names the item and that slice. `quote` for a product row is that roadmap line, taken from the default branch. `files` for a product row lists the concrete repo paths that slice may edit, anywhere in the repo (`apps/mobile`, `site/index.html`, `apps/desktop/src/renderer/src/components/RemoteSettings.tsx`, and whatever else the slice touches). Do not restrict a product row's `files` to marketing or roadmap docs. `docs/ROADMAP.md` is in `files` only when the roadmap line itself changes. Marketing `files` are the copy paths the recommendation named (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`, `site/docs/compare/index.html`, `docs/brand/content-brand-guide.md`, and `docs/ROADMAP.md` when that line changes). When compare copy changes, include `site/docs/compare/index.html` with the two markdown files. `files` is `[]` only when a prior call names none. Do not queue a product row with empty `files`. `quote` for marketing is the sentence to replace; for a prior call, the old call. `replacement` for marketing is the new wording; for a prior call, the new call. For a product row, `replacement` states the slice, Done-when when the roadmap states one, and the dated peer fact when the scan supplied one, so `send_to_chat` tells the child to implement only that slice. For a convention row, `quote` is the current behavior, `replacement` is the better behavior, and `files` lists the paths that hold it, including `docs/system/conventions.md` when a coding convention changes. Do not queue a convention row with empty `files`. The child implements that behavior only on those paths. `url` is the dated source, or `""` when there is none. `status` is `pending`, `approved`, `skipped`, `deferred`, or `shipped`.

`id` is `YYYY-MM-DD-<kind>-<slug>`. The slug is a few kebab-case words from the summary, and the same recommendation on the same day keeps the same id. Upsert that id. When the row is `pending`, refresh the fields and leave the status. When the row is already `approved`, `skipped`, `deferred`, or `shipped`, leave it. A different recommendation is a new row. Do not commit the queue.

## Ask

When this run appended or refreshed a `pending` row, explain the recommendation in a few sentences in the chat, then call `ask_user` with three options:

- **Approve** — implement in a worktree and open a draft PR
- **Skip**
- **Defer**

Then stop. Do not `create_workspace` before the person answers. A queued product recommendation that names one slice and real paths still calls `ask_user`. A quiet day, including a defer-quality day with no slice, does not call `ask_user`. A row that was already decided does not call `ask_user` again.

This Global chat is the orchestrator. There is no named bot and no second orchestrator. The schedule text lives in the local automation, not in this repo. The next run follows this skill. That prompt states the same next step as this skill: the next open slice when it is still the best path, a roadmap change when that slice is the wrong path, or a convention change when a UI or coding convention is in the way. Do not edit `~/Library/Application Support/sideboard/schedules.json` from a worktree.

When the person answers:

- **Approve.** When the recommendation is a prior call, this is the first moment that line may change. Rewrite it in `~/.sideboard/self-improvement.md` to the proposed wording, and keep the old wording under today's report. When the recommendation is a prior call and `files` is empty, set the row to `shipped` and stop. There is no pull request. When `kind` is `product`, `marketing`, or `convention` and `files` is empty, do not `create_workspace`. Set the row to `deferred` and stop. A product or convention row in that state should not have been queued. When `files` is not empty, set the row to `approved`. `list_projects`, then `create_workspace` on the Sideboard repo from `main` (`sourceType` `branch`, `sourceRef` `main`, `repoPath` from that project, `title` from the summary). `create_workspace` takes no prompt. `send_to_chat` on the new chat with a tight prompt from the row: kind, summary, files, quote, replacement, and url. The child implements only what `replacement` names, and only the paths in `files`. For `kind: product`, that is the one slice, not the rest of the Now or Next item. For `kind: convention`, that is the current behavior and the better behavior, only on the paths in `files`. When `site/docs/compare/index.html` is in `files`, edit that HTML by hand so it matches the markdown. Do not run `scripts/render-site-docs.py`. It strips the live chrome. The child opens a draft PR (`gh pr create --draft --assignee @me -R mattlevine/sideboard`) and does not merge. Loop `wait_for_turn` until `stillRunning` is false. Set the row to `shipped` only when a draft PR URL is back. When the child fails or returns no PR URL, set the row back to `pending` so a later run can ask again.
- **Skip.** Set the row to `skipped`. Leave every prior-call line unchanged. If a provisional line was written, restore the previous wording. Stop.
- **Defer.** Set the row to `deferred`. Leave every prior-call line unchanged. If a provisional line was written, restore the previous wording. Stop.

Never merge that PR unless a person asks. This chat does not open the PR. Do not post to X from this turn, and do not post before the pull request is merged.

## After merge

Approve, then the child implements and opens a draft PR. A person, or this orchestrator when a person has asked, merges. This chat does not merge.

When that merged pull request changed `site/`, deploy the marketing site from the repo root before the post. Follow [`.claude/skills/release/SKILL.md`](../release/SKILL.md): `fly deploy --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile .`. Details are in [docs/system/deploy.md](../../../docs/system/deploy.md). Skip the deploy when `site/` did not change.

After the merge, and after that deploy when `site/` changed, follow [`.claude/skills/announce-on-x/SKILL.md`](../announce-on-x/SKILL.md) for that pull request. The account is `@sideboard_build`. The poster dedupes in `~/.sideboard/x-announced.json`. One post or a recorded skip. Do not schedule a later job.

A change to the public homepage or compare story is something a reader can see, so a short positioning note qualifies. announce-on-x skips a merge a reader would not notice: dependency bumps, CI, formatting, review nits, or a release whose notes were already posted. When those skip criteria apply, skip and record the reason. Do not override that skip. "Wording-only" is not itself a reason to skip when the public homepage or compare story changed, and it is not a reason to post when announce-on-x would skip.

## Prior calls

Keep this block at the top of `~/.sideboard/self-improvement.md`, one call per line. Copy a line only when the log has no line for that call. A newer line in the log replaces the same call here.

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
