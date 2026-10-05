# Sideboard vs peers

Short positioning. Not a feature-complete matrix.

Spawning one agent per git worktree is a crowded 2026 pattern (Conductor, Orca, Cursor 3 Agents window, Claude Code, Superset, Emdash, Claude Squad). Sideboard does that too. The comparison that matters is the **orchestration tier**: an agent that can reason about other threads, a board where you can see that, and a phone app, CLI, and MCP so other systems can enter the loop — with compute staying on this Mac (corporate VPN, private git, internal APIs).

Sideboard started as a local port when Conductor moved the rest of that loop into a paid cloud. The kanban, the orchestrator, and remotes (phone, CLI, MCP) are what stayed on this machine.

## vs Conductor (Melty)

Conductor’s free Mac app is a polished human board around local worktrees. Their paid product is [Conductor Cloud](https://www.conductor.build/pricing) (Pro / Teams): Vercel sandboxes in us-east-1, agents that keep running after you close the laptop, multiplayer, and an API against **cloud** workspaces. Cloud session data is stored on Conductor’s servers; local sessions stay on disk.

A serious local orchestration tier would compete with that upsell. Sideboard is the option that keeps the fleet on this machine.

| | Conductor | Sideboard |
|-|-----------|-----------|
| Where agents run | Free: your Mac. Paid: cloud sandbox, off-VPN | Always this Mac — inside the corporate VPN |
| Orchestration | Human-oriented local board; programmatic control is the Cloud API | MCP + Global board, on this Mac |
| Team / remote | Cloud multiplayer and shared workspaces | Phone app paired to this Mac; you pick which desktop to open |
| Away from the laptop | Cloud sandbox keeps running | The phone reaches this Mac only while it is awake (opt-in caffeinate). Local schedules fire the same way. |
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

## vs “open Conductor” clones

Several projects aim to recreate Conductor’s local board (worktrees + terminals + diffs). Sideboard’s wedge is different:

1. **Local orchestration** — MCP so an agent can drive the fleet, and a board so you can see it, without a cloud workspace
2. **Phone to this Mac** — pair from Settings → Remote and pick which desktop to open. Message text only, not a rented sandbox
3. **Handoff** — attach/adopt/Conductor import, not a closed session cage
4. **Surface split** — CLI (zero tokens) vs MCP (judgment) vs desktop (board)

If you only need a TUI/dashboard over `claude`/`codex` worktrees, a thinner clone may be enough. If you need orchestration that other agents can drive, on the VPN you already use, start here.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.

Recurring *method* still belongs on disk — as a committed Claude Code skill (`.claude/skills/<name>/SKILL.md`), not a locked DAG. Sideboard `/name`, Claude Code, and `attach` load the same file. See [Process skills](/docs/skills/).
