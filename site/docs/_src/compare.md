# Sideboard vs peers

Short positioning. Not a feature-complete matrix.

Running one coding agent per git worktree is the shared primitive in 2026 — Conductor, Orca, Herdr, Cursor's Agents window, Superset, Emdash, Claude Squad all do it. Three of those peers now also ship what Sideboard used to call its wedge: a view of every agent's state, a CLI or API that agents themselves can drive, and a way in from another machine. So the comparison below is about the **job each tool is built around**, not about who has worktrees.

- **Conductor** is a finished Mac board, and a paid cloud where the agents keep running after you close the laptop.
- **Orca** is an agent IDE: terminals, embedded browser, diffs with inline comments, many agent CLIs, mobile companion.
- **Herdr** is the runtime: a background server that owns the agents' terminals so they survive a closed lid or a dropped SSH session, with a sidebar of who is working, blocked, or idle.
- **Sideboard** is the control plane: tickets and PRs in, worktrees and agents in the middle, a review of what the agents produced — diff **and** the artifacts, data, and files they made — on the way out. An orchestrator agent runs that loop, on a schedule if you want, and your phone reaches it. All of it on your Mac.

The last point matters for one reason: the Mac is already on the corporate VPN, already logged in to git, already has the internal APIs. Sideboard runs agents as you, there. Conductor Cloud is the only peer that moves compute off the machine; Orca and Herdr are local too, so "local-first" alone does not separate us from them. The loop does.

## At a glance

| Job | Conductor | Orca | Herdr | Sideboard |
|-----|-----------|------|-------|-----------|
| Built around | Workspace UI + paid cloud sandboxes | Agent IDE (ADE) | Terminal runtime for agents | Ticket → worktree → reviewed PR loop |
| Price / license | Free local; Pro $50/mo; Teams $60/user | Free, MIT | Free, AGPL-3.0 | Free, Apache-2.0 |
| Desktop OS | macOS | macOS, Windows, Linux, headless server | macOS, Linux, Windows (one Rust binary) | macOS (Apple Silicon) |
| Agents | Claude Code, Codex, Cursor, others | 27 preconfigured; any CLI agent | 22 detected; any CLI agent | Claude Code, Codex, OpenCode, Cursor |
| Chats per worktree | One | One agent per terminal; several terminals | Several panes per workspace | Several chats share one worktree |
| Fleet view | Workspace list | Kanban (experimental Agent Dashboard) | Sidebar: working / blocked / idle / done | Kanban: New → Draft → Review → Merged |
| Agent-drivable | Cloud API (Pro) | Orca CLI, MCP, hooks, skills | CLI + socket API; agents prompt and wait on each other | CLI (zero tokens) + MCP (judgment across threads) |
| Start from a ticket or PR | PR workflow | Linear native | No | Linear, GitHub, AbleTime; branch or PR |
| Review the output | Diff, PR | Diff with inline comments back to the agent | Terminal | Diff, CI, Review chat, **plus** artifacts, schema'd data, files |
| Scheduled runs | No | No | No | `at` / `every` / `cron` on this Mac |
| Keep running when you close the lid | Cloud sandbox (paid) | Local by default; SSH / your server / VM | Yes — background server, restores after restart | No — Mac must stay awake (opt-in caffeinate) |
| Reach it remotely | Mobile app (Pro) | iOS/Android companion; SSH | Any machine over SSH | Phone app paired to this Mac through a relay |
| Where compute runs | Free: your Mac. Paid: Vercel sandbox, us-east-1 | Your machines | Your machines | This Mac |
| Leave / bring in | Sessions live in the app | Real worktrees; `cd` in | Real terminals | `attach` to the native CLI, `adopt` any worktree, import Conductor |

## vs Conductor (Melty)

Conductor's free Mac app is a polished workspace UI around local worktrees, with unlimited parallel workspaces. Their paid product is [Conductor Cloud](https://www.conductor.build/pricing) (Pro $50/mo, Teams $60/user): Vercel sandboxes in us-east-1, agents that keep running after you close the laptop, multiplayer, a mobile app, and an API against **cloud** workspaces. Cloud session data is stored on Conductor's servers; local sessions stay on disk.

Sideboard started as a local port of that loop and then kept building on the Mac: an orchestrator agent, the board, tickets and connectors, schedules, and the phone.

| Job | Conductor | Sideboard |
|-----|-----------|-----------|
| Where agents run | Free: your Mac. Paid: cloud sandbox, off-VPN | Always this Mac — inside the corporate VPN |
| Orchestration | Human board locally; programmatic control is the Cloud API | MCP + global board, on this Mac; CLI for mechanics |
| Tickets and services | PR workflow | Create from Linear / GitHub / AbleTime; Vercel, Supabase, PostHog, Sentry connectors |
| Review | Diff and PR | Diff, CI, Review chat, and the artifacts / data / files the agent produced |
| Team / remote | Cloud multiplayer, shared workspaces, mobile app (Pro) | Phone app paired to this Mac; you pick which desktop to open |
| Away from the laptop | Cloud sandbox keeps running | Mac must stay awake (opt-in caffeinate); schedules fire the same way |
| Session data | Cloud: Conductor's servers. Local: your disk | Your Mac. Relay carries phone message text only |
| Lock-in | Sessions live in the app | `attach` / `adopt` / Conductor import |

Use Conductor when you want their finished workspace UI, or always-on, off-VPN sandboxes and multiplayer. Use Sideboard when the fleet should stay on this machine and you want tickets, review, schedules, and an orchestrator around it.

## vs Orca

[Orca](https://www.onorca.dev/) is an **agent development environment**: parallel worktrees, GPU terminals, embedded Chromium with design mode, inline diff comments sent back to the agent, 27 preconfigured agent CLIs, an `orca` CLI that agents drive (`worktree create`, `snapshot`, `click`, `fill`), MCP / hooks / skills, an experimental kanban of agents, remote worktrees over SSH or a self-hosted server, and an iOS / Android companion. MIT, macOS / Windows / Linux. Orca launches each agent with its permission-bypass flag by default on the theory that the worktree is the sandbox.

That is a bigger surface than Sideboard's, and a different one. Orca is where you *work with* agents. Sideboard is where the work *comes from and goes to*: the ticket, the schedule, the review of outputs that are not code, the PR.

| Job | Orca | Sideboard |
|-----|------|-----------|
| Category | Agent IDE | Control plane for the loop |
| Review | Diff with inline comments | Diff, CI, Review chat, artifacts, schema'd data, files |
| Fleet view | Experimental kanban | Kanban as the home screen |
| Agent-drivable | Orca CLI, MCP, hooks | CLI (zero tokens) + MCP; the orchestrator is itself an agent |
| Tickets | Linear native | Linear, GitHub, AbleTime; branch or PR |
| Scheduled runs | No | Yes |
| Agents | 27 | 4 |
| Desktop OS | macOS, Windows, Linux | macOS (Apple Silicon) |
| Permissions | Bypass by default | Agent defaults; `land` and `purge` stay human-only |

Use Orca when you want the whole agent IDE and many harnesses, on any OS. Use Sideboard when you want the loop around the IDE — tickets in, reviewed PRs out, on a schedule, from your phone — and you are on a Mac with Claude Code, Codex, OpenCode, or Cursor.

## vs Herdr

[Herdr](https://herdr.dev/) is a terminal workspace manager for coding agents — tmux-shaped, mouse-first, one Rust binary on macOS / Linux / Windows. A background server owns the terminals, so agents keep running when you close the client or lose SSH, and the layout (and supported agent sessions) comes back after a restart. It detects which agent is working, blocked, idle, or done from the screen, lists machines over SSH side by side, has a plugin marketplace, ships a `SKILL.md` so agents can drive it, and exposes a CLI and socket API for spawning panes, prompting other agents, and waiting until one is blocked. `herdr worktree create` landed in v0.6.1. AGPL-3.0.

Herdr and Sideboard overlap on the sentence "agents can drive it and you can see who is stuck." They do not overlap on the job. Herdr is the runtime: terminals that outlive you. Sideboard is the loop: where the work started, what the agent made, whether it is ready to land.

| Job | Herdr | Sideboard |
|-----|-------|-----------|
| Category | Terminal runtime for agents | Control plane for the loop |
| Survives a closed lid / dropped SSH | Yes — core feature | No — this Mac must stay awake |
| Fleet view | Sidebar of agent states, per machine | Kanban of worktrees by PR state, with live output |
| Agent-drivable | CLI + socket API, pane-level | CLI + MCP, thread-level (wait on a turn, read a diff, fork a worktree, schedule) |
| Review | Read the terminal | Diff, CI, Review chat, artifacts, schema'd data, files |
| Tickets / PRs / connectors | No | Yes |
| Remote | Any machine over SSH | Phone app to this Mac |
| Desktop OS | macOS, Linux, Windows | macOS (Apple Silicon) |

Use Herdr when you want terminals that do not stop when you do, across several machines. Use Sideboard when you want the ticket, the review, and the PR around the agent. They can share a repo: `adopt` brings a worktree Herdr created onto the board.

## vs "open Conductor" clones

Several OSS projects recreate Conductor's local board (worktrees + terminals + diffs). Sideboard's wedge is upstream and downstream of that board:

1. **Tickets in** — create a worktree from a Linear, GitHub, or AbleTime issue, a branch, or a PR
2. **An orchestrator that is an agent** — MCP so it can wait on turns, read diffs, fork worktrees, and schedule the next run; CLI for the mechanical parts at zero tokens
3. **Review beyond the diff** — `present_artifact`, `present_schema`, `present_files` put what the agent built next to the code
4. **Handoff** — `attach`, `adopt`, Conductor import; not a session cage

If you only need a dashboard over `claude` / `codex` worktrees, a thinner clone may be enough.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.

Recurring *method* still belongs on disk — as a committed Claude Code skill (`.claude/skills/<name>/SKILL.md`), not a locked DAG. Sideboard `/name`, Claude Code, and `attach` load the same file. Exploratory fleet work stays a loop; fan-out that will repeat earns a skill. Sideboard also ships `/long-running` to every worktree agent. See [Process skills](/docs/skills/).
