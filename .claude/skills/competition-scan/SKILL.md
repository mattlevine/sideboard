---
name: competition-scan
description: >-
  Daily scan of products in Sideboard's space. Report what changed and one
  recommendation: a product change, how the marketing talks about it, or a
  change to a prior call. Prior calls can move. Use when the competition-scan
  automation fires, or when someone asks for a competitive scan. The report
  stays in the chat. Do not open a pull request.
---

# Competition scan

One report per run. What changed since the last run among products that orchestrate coding agents, and at most one change Sideboard should make. A quiet day is a short report that says the set is unchanged.

## When

The local automation fires this in a new Global chat, or a person asks for a competitive scan. Do the scan in that turn. Do not create another schedule.

## Read first

1. `~/.sideboard/competition-scan.md`. Prior calls and past reports. A prior call is the last answer, not a ban. Create the file if it is missing, with the prior calls below copied to the top.
2. The Sideboard checkout that contains this skill. Read the pitch and the compare notes from that checkout:
   - `README.md` through "Why it exists"
   - `site/index.html` (the homepage)
   - `docs/COMPARE.md` and `site/docs/_src/compare.md`. They carry the same facts and different links. When they disagree, say so in the report.
3. `list_schedules`. Find this automation and the previous run's chat id. `get_chat` on that id is a preview. The log file is the record.

Find the checkout with `list_projects` and the workspaces on the Sideboard repo. Prefer the checkout whose copy of this skill is present. Read the pitch and the compare notes from that same checkout. Leave the main repo checkout unedited.

## Who

Start from the peers named in the compare notes: Conductor, Orca (an agent IDE with an embedded editor, the orchestration CLI, and Orca Bots), Superset / Paradev, the Codex app remote, Claude Code Remote Control, Multica, and local worktree-board clones.

Also look for a product that appeared since the last log entry and does the same job: a fleet of Claude Code, Codex, Cursor, or OpenCode, on git worktrees, with a board, a phone, or a way for another agent to drive the fleet.

Search the open web. Prefer a primary source with a date: changelog, release notes, docs, or a founder post. Skip undated roundups and pages that only restate a homepage.

## Judge

Sideboard today is an agentic development environment (an agent IDE): a local fleet orchestrator. The checkout is the unit. One orchestrator on this Mac can see every chat. The phone is the remote. Slack is collaboration. Skills live in the repo. Compute stays on this Mac. The desktop has a file editor, a terminal, and a URL preview. `attach` returns to the harness session. A peer that centers an embedded terminal, browser, or design mode is still in the same category. Do not treat "agent IDE" as a label that belongs only to Orca. Do not write that those panes are absent. That description is the current shape. A recommendation may move it.

Recommend at most one change. It may be product, marketing, or a change to a prior call. Leave a prior call in place on a day when nothing new makes it the right change. Change it when the peer, the product, or the pitch has moved, or when the old answer is now the wrong product. Name the old call and why it should move.

A product recommendation names the surface (board, orchestrator, phone, Slack, skills, or a prior call), the fact that prompted it, and the URL when there is one.

A marketing recommendation names the file (`README.md`, `site/index.html`, `docs/COMPARE.md`, or `site/docs/_src/compare.md`), quotes the sentence, and writes the replacement. It qualifies when that sentence is false, or when it is still true and the positioning is stale — the sentence tells the wrong story about this shape. Include the fact that prompted it and the URL when there is one.

Last answers as of 2026-11-24, for Orca Bots. Same rule as every other prior call:

- One Needs you list across the board.
- A reply in the thread that asked. A mention wakes the orchestrator with a note. It does not start a workspace.
- Playbooks live as skills plus a schedule.

Also last answers as of 2026-11-24:

- A named bot with its own soul, as a second identity beside the orchestrator.
- A Slack app per bot, and teammates whose requests run as the person at this Mac.
- Gmail, calendar, or a general connector catalog on the orchestrator.
- Bot groups across computers.
- Memory the agent rewrites on its own.
- Design mode, computer use, or a mobile emulator. The desktop already has a file editor, a terminal, and a URL preview. `attach` returns to the harness session.

## Report

Write the report in the chat, in this order:

- **Changed.** Product, what shipped, date, and URL. Leave out anything you cannot date or source.
- **New name.** A product missing from the compare notes. One sentence on its shape, and whether the notes should name it.
- **Recommendation.** Zero or one. A product surface, marketing copy (`README.md`, `site/index.html`, `docs/COMPARE.md`, `site/docs/_src/compare.md`), or a change to a prior call. For marketing, name the file, quote the sentence, and write the replacement. For a prior call, name the old call and why it should move. A stale true sentence qualifies. When nothing qualifies, write that the set is unchanged.
- **Compare notes.** Use this only when the recommendation is a product change and a compare sentence is also false or stale. Quote it and write the replacement. Name both `docs/COMPARE.md` and `site/docs/_src/compare.md`. When the one recommendation is itself that wording change, it belongs under Recommendation.

Append the same report under today's date in `~/.sideboard/competition-scan.md`. Keep prior calls at the top. When the recommendation changes a prior call, rewrite that line and keep the old wording under today's report. Do not commit the log.

Do not edit the compare notes, the README, or the homepage. Do not open a pull request. Do not create a workspace. The person decides what to change.

## Prior calls

Keep this block at the top of `~/.sideboard/competition-scan.md`. These are the last answers. A later scan may replace one.

- 2026-11-24 — Orca Bots (beta, [v1.4.265](https://orca.dev/changelog/1-4-265), November 19, 2026) are a named folder on one computer: soul, memory, one harness. Slack, Linear, GitHub, Gmail, Calendar, and webhooks start runs. Code goes to a child worktree. Orca Cloud holds the inbound request until the computer takes it. Sideboard keeps a single orchestrator. The parts that fit, as of this date, are a Needs you list, a reply in the thread that asked, and playbooks as skills. The bot identity stayed out.
