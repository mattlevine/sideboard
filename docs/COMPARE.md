# Sideboard vs peers

Short positioning for contributors and evaluators. Not a feature-complete matrix.

Spawning one agent per git worktree is a crowded 2026 pattern (Conductor, Orca, Cursor 3 Agents window, Claude Code, Superset, Emdash, Claude Squad). [Multica](https://github.com/multica-ai/multica) is the other shape: an issue tracker where agents are assignees, and a daemon on a computer you connect runs the CLI. Sideboard isolates the checkout and runs many agents on it. The comparison that matters is the **orchestration tier**: an agent that can reason about those chats, a board where you can see that, and a phone app, CLI, and MCP so other systems can enter the loop — with compute staying on this Mac (corporate VPN, private git, internal APIs). README [Who it's for](../README.md#who-its-for) is the ICP cut.

Sideboard started as a local port when Conductor moved the rest of that loop into a paid cloud. The kanban, the orchestrator, and remotes (phone, CLI, MCP) are what stayed on this machine. The phone app is the remote. Slack is not.

## vs Conductor (Melty)

Conductor’s free Mac app is a polished human board around local worktrees. Their paid product is [Conductor Cloud](https://www.conductor.build/pricing) (Pro / Teams): Vercel sandboxes in us-east-1, agents that keep running after you close the laptop, multiplayer, and an API against **cloud** workspaces. Cloud session data is stored on Conductor’s servers; local sessions stay on disk.

A serious local orchestration tier would compete with that upsell. Sideboard is the option that keeps the fleet on this machine.

| | Conductor | Sideboard |
|-|-----------|-----------|
| Where agents run | Free: your Mac. Paid: cloud sandbox, off-VPN | Always this Mac — inside the corporate VPN |
| Orchestration | Human-oriented local board; programmatic control is the Cloud API | MCP + Global board, on this Mac |
| Team / remote | Cloud multiplayer and shared workspaces | Phone app paired to this Mac; you pick which desktop to open |
| Away from the laptop | Cloud sandbox keeps running | A connected phone keeps this Mac awake while Sideboard.app or `sideboard serve` is the host (lid can close on power; battery may still sleep). Automations still opt in. |
| Session data | Cloud: Conductor’s servers. Local: your disk | Your Mac. Relay routes phone chat only |
| Work on `main` in the project folder | Always a sidecar worktree | Opt-in cowboy (Settings → Advanced; off by default) |
| Lock-in | Sessions live in the app | `attach` / `adopt` — move in and out of native CLIs |

Use Conductor when you want their finished Mac workspace UI, or their cloud sandboxes (always-on, off-VPN, paid). Use Sideboard when the fleet should stay on this machine and the phone app, CLI, and MCP are how you enter the loop.

## vs Orca

[Orca](https://www.onorca.dev/) is an **agent development environment** (ADE): parallel worktrees plus terminals, an embedded browser, design mode, a CLI that agents can drive, remote worktrees over SSH, and a mobile companion. It is open source (MIT) and runs on macOS, Windows, and Linux. Bring-your-own-agent is the default — dozens of CLI harnesses.

Sideboard is not trying to be an IDE. It is the layer above the IDE: a kanban of the fleet, an orchestrator MCP, and remotes so other systems can reach this Mac.

| | Orca | Sideboard |
|-|------|-----------|
| Category | Agent IDE / ADE | Local orchestration for a fleet |
| Surfaces | App, terminal, browser, mobile | Desktop board, CLI, MCP, phone |
| Other systems | Orca CLI; mobile companion | `sideboard` CLI, stdio MCP, phone paired to this Mac |
| Desktop OS | macOS, Windows, Linux | macOS (Apple Silicon) |
| Compute | Local by default; SSH / your VPS | Always this Mac |

Use Orca when you want the whole agent IDE (terminal + browser + design mode) and you are happy driving it from that app. Use Sideboard when you want an orchestrator other agents can call, a board of the fleet, and a phone app without moving compute off this machine.

## vs Multica

[Multica](https://github.com/multica-ai/multica) is a source-available workspace where people and agents share one issue tracker. An agent is a durable identity: name, instructions, skills, and which computer runs it. A run is one execution of that identity. The board is issues, not checkouts. A daemon on your machine (or a box you control) claims the run and drives a CLI you already installed — the docs list 31. A run checks out a worktree (or edits a local directory in place). The control plane is [multica.ai](https://multica.ai) or a Go API and Postgres you host. Web, desktop (macOS, Windows, Linux), and an iOS app you build from source. The license is Apache 2.0 plus extra terms for hosted services, commercial embedding, and branding.

Sideboard does not put a server between you and the checkout. The workspace is the git worktree, several chats share it, and the orchestrator is an agent on this Mac.

| | Multica | Sideboard |
|-|---------|-----------|
| The record | Issue: goal, comments, status, every run | Workspace: one checkout, many chats |
| Who an agent is | Named teammate. The config survives the run | Which CLI is plugged into this chat |
| Where it runs | Daemon on a computer you connect. The server stores issues, comments, and transcripts | Always this Mac. No account |
| Other systems | `multica` CLI and HTTP API. Agents use the same path | `sideboard` CLI, stdio MCP, phone paired to this Mac |
| When you are needed | Inbox: mentions and failures. Status-change notifications are off by default. Routine comments on someone else’s issue stay on the issue | Board and the open chat. The phone alerts when a chat needs you, a turn finishes, or a chat fails (Sideboard relay). A custom relay does not push. Alerts name the Mac and carry no message text |
| Handoff | A workflow step assigns the next agent on the same issue. Agents move work to in review; done follows a merged PR or a person | PR columns on the board. Merge stays human |
| Skills | Workspace copies attached to specific agents, plus whatever the CLI reads from the repo | The repo’s `.claude/skills/`. The same file for Sideboard, Claude Code, and `attach` |

Use Multica when the team should assign issues to named agents, keep the transcript on the issue, and accept a control plane (theirs or yours). Use Sideboard when the fleet should stay on this machine and another agent should drive it over MCP, with no server holding the session.

## vs “open Conductor” clones

Several OSS projects aim to recreate Conductor’s local board (worktrees + terminals + diffs). Sideboard’s wedge is different:

1. **Local orchestration** — MCP so an agent can drive the fleet, and a board so you can see it, without a cloud workspace
2. **Phone to this Mac** — pair from Settings → Remote and pick which desktop to open. Message text only, not a rented sandbox
3. **Handoff** — attach/adopt/Conductor import, not a closed session cage
4. **Surface split** — CLI (zero tokens) vs MCP (judgment) vs desktop (board)

If you only need a TUI/dashboard over `claude`/`codex` worktrees, a thinner clone may be enough. If you need orchestration that other agents can drive, on the VPN you already use, start here.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.

Recurring *method* still belongs on disk — as a committed Claude Code skill (`.claude/skills/<name>/SKILL.md`), not a locked DAG. Sideboard `/name`, Claude Code, and `attach` load the same file. Exploratory fleet work stays a loop; fan-out that will repeat earns a skill. This repo’s method skill is [`/graph-engineering`](../.claude/skills/graph-engineering/SKILL.md). Sideboard also ships `/long-running` to every worktree agent (product skill). See [Process skills](../README.md#process-skills).
