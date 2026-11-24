# Sideboard vs peers

Short positioning for contributors and evaluators. Not a feature-complete matrix. Sources were read on 2026-11-22 unless a page itself carries an earlier date this quarter. Undated product docs are cited as read that day.

Spawning one agent per git worktree is a crowded 2026 pattern (Conductor, Orca, Superset, Cursor's Agents window, Claude Code, Emdash). [Multica](https://github.com/multica-ai/multica) is the other shape: an issue tracker where agents are assignees, and a daemon on a computer you connect runs the CLI. Sideboard isolates the checkout and runs many agents on it. The comparison that matters is the **orchestration tier**: an agent that can reason about those chats, a board where you can see that, and a phone app, CLI, and MCP so other systems can enter the loop — with compute staying on this Mac (corporate VPN, private git, internal APIs). README [Who it's for](../README.md#who-its-for) is the ICP cut.

Sideboard is an agentic development environment (an agent IDE). Local fleet orchestrator is the shape: the checkout is the unit, and `attach` returns to the harness session. The desktop also has a file editor, a terminal, and a URL preview.

Sideboard started as a local port when Conductor moved the rest of that loop into a paid cloud. The kanban, the orchestrator, and remotes (phone, CLI, MCP) are what stayed on this machine. The phone app is the remote. Slack is not. One phone covers Claude Code, Codex, OpenCode, and Cursor. The Codex app and Claude Code Remote Control each cover one harness.

## vs Conductor (Melty)

Conductor is joining Meta. The founder's announcement is [Conductor is joining Meta](https://www.conductor.build/announcement) (November 4, 2026). [TechCrunch](https://techcrunch.com/2026/11/04/meta-acquires-ai-coding-startup-conductor/) reported the acquisition the same day.

The Mac app is a board around local worktrees. Conductor Cloud is the sandbox product. A Cloud shutdown was announced with the acquisition and withdrawn on November 13, 2026 ([changelog 0.94.2](https://www.conductor.build/changelog/0.94.2-conductor-is-back), "Conductor is back"). The announcement page still contains both the earlier Cloud wind-down and the later "plans have changed."

The iOS app is not only the cloud product. [Remote control](https://www.conductor.build/docs/reference/remote-control) (shipped in [0.92.0](https://www.conductor.build/changelog/0.92.0-remote-control), October 23, 2026) lets the iOS app browse and create **local** workspaces, read and send chats, pick models, stop agents, and archive workspaces. It is experimental (`Settings → Experimental → Remote control`). Both devices sign in to the same Conductor account, Conductor must be open on an awake Mac, and the traffic is end-to-end encrypted through Conductor's relay.

| | Conductor | Sideboard |
|-|-----------|-----------|
| Where agents run | Local workspaces on the Mac, and Conductor Cloud | Always this Mac — inside the corporate VPN |
| Phone | iOS remote control of local workspaces. Experimental. Same Conductor account. Conductor open on an awake Mac | Phone app paired to this Mac. No vendor account between the phone and the fleet |
| Orchestration | Human board. Programmatic control of cloud workspaces is the Cloud API | MCP + Global board, on this Mac |
| Away from the laptop | Cloud workspaces, where Cloud is available. Remote control keeps the Mac awake while the iPhone is connected and the Mac is plugged in (0.92.0) | A connected phone keeps this Mac awake while Sideboard.app or `sideboard serve` is the host (lid can close on power; battery may still sleep). Automations still opt in |
| Work on `main` in the project folder | Always a sidecar worktree | Opt-in cowboy (Settings → Advanced; off by default) |
| Lock-in | Sessions live in the app | `attach` / `adopt` — move in and out of native CLIs |

Sideboard keeps the fleet on this machine. The phone app, CLI, and MCP are how you enter the loop.

## vs Orca

[Orca](https://www.onorca.dev/) is an **agent development environment**: parallel worktrees, terminals, an embedded browser, design mode, a mobile companion, and Windows and Linux, with many CLI harnesses. It also has an [orchestration CLI](https://orca.dev/docs/cli/orchestration): a Run, tasks, supervised workers, and decision gates. The CLI talks to a running Orca app. The docs mark orchestration experimental (`Settings → Experimental`). A worker can be Claude, Codex, Cursor, OpenCode, or another harness Orca launches, often in its own worktree.

Orca having that CLI means "Sideboard has an orchestrator and Orca does not" is not the split. Both are agentic development environments (agent IDEs). The split is the checkout, the board, and where the editor lives:

- Several Sideboard chats share one checkout (`fork_chat`). Orca's supervised workers are started on a worktree, including a new child worktree.
- One Sideboard board covers every harness. Orca's orchestration runs inside the Orca app.
- The desktop has a file editor, a terminal, and a URL preview. `attach` returns to the harness session. Orca's workspace is the embedded terminal, browser, and design mode.

| | Orca | Sideboard |
|-|------|-----------|
| Category | Agent IDE, plus an orchestration CLI | Agent IDE (agentic development environment). Local fleet orchestrator. `attach` returns to the harness session |
| Checkout | A worker can take the current worktree or a new child | Several chats share one checkout |
| Board | Inside the Orca app | One board across Claude Code, Codex, OpenCode, and Cursor |
| Other systems | `orca` CLI against a running Orca app; mobile companion | `sideboard` CLI, stdio MCP, phone paired to this Mac |
| Desktop OS | macOS, Windows, Linux | macOS (Apple Silicon) |
| Compute | Local by default; SSH / your VPS | Always this Mac |

## vs Superset

[Superset](https://github.com/superset-sh/superset) is the same shape as Sideboard: a task gets its own git worktree, and many CLI harnesses run there. The docs now call the product Paradev, formerly Superset. The hosted MCP is still `https://api.superset.sh/mcp` ([Paradev MCP server](https://docs.paradev.com/mcp-server)).

That MCP is not a local stdio server. OAuth 2.1 scopes the token to the active organization. A headless client uses an API key created in the app (`Settings → API Keys`), and that key also grants the organization. Sideboard's MCP is stdio on this Mac and needs no org sign-in.

| | Superset | Sideboard |
|-|----------|-----------|
| Shape | Task, git worktree, many CLIs | Workspace, git worktree, many chats |
| MCP | Hosted at `api.superset.sh`. Org OAuth, or an org API key | Local stdio. No account |
| Where agents run | A registered host, or a Superset-managed cloud workspace | Always this Mac |

## vs the Codex app and Claude Code Remote Control

Each of these is a phone remote for one harness on a machine you own.

The [Codex remote connection](https://learn.chatgpt.com/docs/remote-connections) is the ChatGPT mobile app driving Codex on a Mac or Windows PC that is running the ChatGPT desktop app, or on an SSH host. Setup starts in the desktop app (`Settings → Connections → Control this Mac or PC`), not in the Codex CLI. Files, credentials, and tools stay on that host.

[Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) connects the Claude app (iOS and Android) or claude.ai/code to one Claude Code session. The session keeps running on the machine, so the filesystem and MCP servers stay there. The computer has to stay on, and the `claude` process has to keep running. It is Claude Code only.

Sideboard's phone is one client for every harness on this Mac, and the board shows all of them.

## vs Multica

[Multica](https://github.com/multica-ai/multica) is a source-available workspace where people and agents share one issue tracker. An agent is a durable identity: name, instructions, skills, and which computer runs it. A run is one execution of that identity. The board is issues, not checkouts. A daemon on your machine (or a box you control) claims the run and drives a CLI you already installed — the docs list 31. A run checks out a worktree (or edits a local directory in place). The control plane is [multica.ai](https://multica.ai) or a Go API and Postgres you host. Web, desktop (macOS, Windows, Linux), and an iOS app you build from source. The license is Apache 2.0 plus extra terms for hosted services, commercial embedding, and branding.

Read 2026-11-22 from the public repo and docs: `README`, `VISION`, concepts, agents, squads, inbox, runs, autopilots, issue wakeups, workflows, analytics, providers, daemon, security model.

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

Sideboard keeps the fleet on this machine. Another agent drives it over MCP, and no server holds the session.

## vs “open Conductor” clones

Several OSS projects aim to recreate Conductor’s local board (worktrees + terminals + diffs). Sideboard’s wedge is different:

1. **Local orchestration** — MCP so an agent can drive the fleet, and a board so you can see it, without a cloud workspace
2. **Phone to this Mac** — pair from Settings → Remote and pick which desktop to open. Message text only, not a rented sandbox
3. **Handoff** — attach/adopt/Conductor import, not a closed session cage
4. **Surface split** — CLI (zero tokens) vs MCP (judgment) vs desktop (board)

Sideboard is the orchestration those agents can drive, on the VPN you already use.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.

Recurring *method* still belongs on disk — as a committed Claude Code skill (`.claude/skills/<name>/SKILL.md`), not a locked DAG. Sideboard `/name`, Claude Code, and `attach` load the same file. Exploratory fleet work stays a loop; fan-out that will repeat earns a skill. This repo’s method skill is [`/graph-engineering`](../.claude/skills/graph-engineering/SKILL.md). Sideboard also ships `/long-running` to every worktree agent (product skill). See [Process skills](../README.md#process-skills).

## Sources

Read 2026-11-22 unless noted.

- Conductor joining Meta, November 4, 2026: [announcement](https://www.conductor.build/announcement), [TechCrunch](https://techcrunch.com/2026/11/04/meta-acquires-ai-coding-startup-conductor/).
- Conductor Cloud shutdown withdrawn, November 13, 2026: [changelog 0.94.2](https://www.conductor.build/changelog/0.94.2-conductor-is-back).
- Conductor iOS remote control of local workspaces, October 23, 2026: [changelog 0.92.0](https://www.conductor.build/changelog/0.92.0-remote-control), [Remote control](https://www.conductor.build/docs/reference/remote-control).
- Orca orchestration CLI: [Orchestration](https://orca.dev/docs/cli/orchestration).
- Superset / Paradev hosted MCP: [MCP server](https://docs.paradev.com/mcp-server).
- Codex on a connected computer: [Remote connections](https://learn.chatgpt.com/docs/remote-connections).
- Claude Code Remote Control: [Remote Control](https://code.claude.com/docs/en/remote-control).
- Multica: public repo and docs listed in [vs Multica](#vs-multica).
