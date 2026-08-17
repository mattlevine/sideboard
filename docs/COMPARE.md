# Sideboard vs peers

Short positioning for contributors and evaluators. Not a feature-complete matrix.

Spawning one agent per git worktree is a crowded 2026 pattern (Conductor, Cursor 3 Agents window, Claude Code, Superset, Emdash, Claude Squad). Sideboard does that too. The comparison that matters is the **orchestration tier**: an agent that can reason about other threads, a board where you can see that, and Slack so a coworker can enter the loop — with compute staying on this Mac (corporate VPN, private git, internal APIs). README [Who it's for](../README.md#who-its-for) is the ICP cut.

## vs Conductor (Melty)

Conductor’s free Mac app is a polished human board around local worktrees. Their paid product is [Conductor Cloud](https://www.conductor.build/pricing) (Pro / Teams): Vercel sandboxes in us-east-1, agents that keep running after you close the laptop, multiplayer, and an API against **cloud** workspaces. Cloud session data is stored on Conductor’s servers; local sessions stay on disk.

A serious local orchestration tier would compete with that upsell. Sideboard is the option that keeps the fleet on this machine.

| | Conductor | Sideboard |
|-|-----------|-----------|
| Where agents run | Free: your Mac. Paid: cloud sandbox, off-VPN | Always this Mac — inside the corporate VPN |
| Orchestration | Human-oriented local board; programmatic control is the Cloud API | MCP + Global board, on this Mac |
| Team / remote | Cloud multiplayer and shared workspaces | Slack to this Mac; `slack_post` a review ping; replies come back as info |
| Away from the laptop | Cloud sandbox keeps running | Slack reaches this Mac only while it is awake |
| Session data | Cloud: Conductor’s servers. Local: your disk | Your Mac. Relay routes Slack chat only |
| Lock-in | Sessions live in the app | `attach` / `adopt` — move in and out of native CLIs |

Use Conductor when you want their finished Mac workspace UI, or their cloud sandboxes (always-on, off-VPN, paid). Use Sideboard when the fleet should stay on this machine and Slack is how you and a coworker enter the loop.

## vs “open Conductor” clones

Several OSS projects aim to recreate Conductor’s local board (worktrees + terminals + diffs). Sideboard’s wedge is different:

1. **Local orchestration** — MCP so an agent can drive the fleet, and a board so you can see it, without a cloud workspace
2. **Slack to this Mac** — inbound to the orchestrator, outbound review pings, replies as information — not a rented sandbox
3. **Handoff** — attach/adopt/Conductor import, not a closed session cage
4. **Surface split** — CLI (zero tokens) vs MCP (judgment) vs desktop (board)

If you only need a TUI/dashboard over `claude`/`codex` worktrees, a thinner clone may be enough. If you need orchestration that other agents can drive, on the VPN you already use, start here.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.

Recurring *method* still belongs on disk — as a committed Claude Code skill (`.claude/skills/<name>/SKILL.md`), not a locked DAG. Sideboard `/name`, Claude Code, and `attach` load the same file. Exploratory fleet work stays a loop; fan-out that will repeat earns a skill. This repo’s method skill is [`/graph-engineering`](../.claude/skills/graph-engineering/SKILL.md). See [Process skills](../README.md#process-skills).
