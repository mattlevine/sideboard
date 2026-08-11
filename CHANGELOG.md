# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.57] - 2026-08-11

### Fixed

- MCP-created threads no longer stall in `queued` after the MCP stdio child exits: desktop adopts persisted queues from the thread-store watcher; MCP startup no longer drains the whole fleet into short-lived processes
- Clear dead `agentPid` / heal empty `queued` status so drain cannot pin forever

## [0.1.56] - 2026-08-11

### Fixed

- Archiving the last worktree no longer removes the project from the sidebar; projects stay registered until explicitly removed
- Workspace discovery again includes archived threads (explicit removals still stick via `removed-workspaces.json`)

### Changed

- Deleting/archiving a worktree is non-blocking: the confirm dialog closes immediately and progress shows in the chat empty pane (same pattern as create)

## [0.1.55] - 2026-08-11

### Fixed

- Cloud orchestrator and MCP-spawned worktrees now use Account default agent, model, effort, and fast (Settings → Default agent, model & effort) instead of hard-coding Claude / Auto
- `create_thread` agent/model are optional; omitting them applies Account defaults (tool + coordinator prompts document the current defaults)

### Changed

- Cloud connect coordinator follows the Account default agent when it can orchestrate (Claude / Cursor / Codex / OpenCode); the Brightsy-only fallback picker remains for when the default is Brightsy
- New threads created via `createThread` / `createGlobalChat` fill omitted model/effort/fast from Account defaults

## [0.1.54] - 2026-08-10

### Fixed

- Cursor MCP `present_artifact` / present_* tools now show in chat and open the side column (normalize nested `mcp` tool calls + unwrap result envelopes)
- OpenCode no longer drops text/tools/usage when `sessionID` is present on every event; tool calls read `part.state.input` / `output`
- Codex maps `mcp_tool_call` items into tool chips / artifacts and auto-approves injected MCP tools in headless exec
- Schema/files pane extractors accept Cursor-style nested MCP payloads

### Changed

- README hero screenshot refreshed (`sideboard-desktop-review-v4.png`)

## [0.1.53] - 2026-08-10

### Added

- Markdown table repair for common agent mistakes (short `|---|` delimiters expanded to match header columns)

### Fixed

- Cursor follow-ups no longer fail with “already has active run”: stale SDK runs are cancelled and the send is retried
- OpenCode no longer auto-adopts another chat’s session in the same worktree; invalid Claude/Codex/OpenCode resume clears `sessionId` and retries once with a seeded fresh session

### Changed

- Creating a worktree is non-blocking: the create dialog closes immediately and progress shows in the chat empty state above “What are you working on?”; setup continues in the background after the worktree exists

## [0.1.52] - 2026-08-10

### Added

- GitHub PR stacks (first-class): `gh stack` wrappers, one worktree per layer, right-sidebar stack map (open layer / open all / add layer), merge via `gh stack merge`, MCP `get_pr_stack` / `open_pr_stack_layers` / `add_stack_layer` / `create_pr_stack`
- Plan mode clarifying questions: agents call Sideboard MCP `ask_user` (or Claude `AskUserQuestion`); Conductor-style composer UI with numbered options, **Other…**, pagination, and dismiss. Agents explain option tradeoffs in chat first; Sideboard also mirrors questions + option descriptions in the transcript
- Plan ready actions: **Copy**, **Hand off** (fork chat + implement), and **Approve** (⌘⇧↵) in the composer when the plan is ready — optional composer notes are included; the plan markdown in chat is presentation-only
- Plan mode writes `.context/attachments/plan.md` via MCP `present_plan` and shows the plan markdown in chat for approval (shared across forked chat tabs in the same worktree)
- Sidebar worktree row actions (Conductor-style): archive + edit icons on row hover; each opens a hover card — archive confirms removal, edit shows git `+N −M` / clean plus Create PR / Open PR

### Changed

- Workspace-local scratch (plans, composer drops, local Review seed) moves to `.context/attachments/` (Conductor-style); committed Sideboard config stays under `.sideboard/` (`settings.toml`, `review.md`). Legacy `.sideboard/attachments/` still readable
- Right sidebar: when a PR has merge conflicts, the pill shows **Merge conflicts** and the primary button becomes **Resolve** (queues merging the PR base into the branch)
- New worktrees always run setup via Orchestrator `runSetup` (sidebar Setup tab events) after create / fork / stack layer open
- Release workflow triggers only on `v*` tags (no more empty failing Release runs on every branch push)

### Removed

- Composer “Plan mode stays on…” banner (redundant with the plan-mode chip)

## [0.1.51] - 2026-08-10

### Fixed

- Creating a PR worktree from the orchestration agent no longer fails when the GUI app lacks SSH keys: PR head fetch falls back to HTTPS authenticated with `gh auth token`
- Closing the last orchestration (or worktree) chat tab returns to the board instead of leaving the archived chat open in the pane
- PR review worktrees show **Merge** (not **Commit & push**) when the only local dirt is Sideboard `.sideboard/attachments` scratch from Review

## [0.1.50] - 2026-08-10

### Fixed

- Right sidebar git button refreshes after a worktree turn finishes (including sibling chats) and re-fetches the remote tip so **Commit & push** flips to **Merge** once the branch is clean and pushed
- Right sidebar is keyed to the active worktree and ignores stale diff/PR results from a previous worktree

## [0.1.49] - 2026-08-10

### Added

- Sidebar highlights worktree / orchestration rows when an agent turn finishes while that row isn’t open, until you click in
- Per-repo Review guidelines via committed `.sideboard/review.md` (preferred over local attachments scratch)

### Changed

- Orchestration (global) dashboard card titles and message previews use the same chat type scale as thread chat

### Fixed

- Review button again attaches guidelines and sends the short **Review.** message (not a long user prompt)

## [0.1.48] - 2026-08-09

### Added

- Sent user messages keep attachment chips / image thumbnails in chat history

### Changed

- Chat message type size bumped for readability (closer to Cursor)

## [0.1.47] - 2026-08-09

### Fixed

- Desktop 0.1.46 would not launch: asar packing raced with MCP bin shebang rewriting and corrupted `package.json` — shebang is now emitted by tsup at build time; release verifies asar health
- README: how to connect Sideboard MCP from Claude Code, Cursor, Codex, and OpenCode

## [0.1.46] - 2026-08-09

### Changed

- Orchestrators must use MCP-capable agents only (Claude, Cursor, Codex, OpenCode) — Brightsy can still run as a worktree agent but cannot be selected as an orchestrator or quota-fallback agent

### Fixed

- Cursor, Codex, and OpenCode turns now inject Sideboard MCP (and Brightsy when logged in), matching Claude — orchestration no longer falls back to the CLI for fleet tools
- Brightsy CLI still has no local MCP injection hook (`brightsy chat` has no MCP flags); use Claude / Cursor / Codex / OpenCode for Sideboard MCP fleet control

## [0.1.45] - 2026-08-09

### Added

- MCP `list_models` — list models per agent when pinning a specific model (default remains Auto)
- MCP `fork_worktree` / `fork_chat` — fork a worktree chat into a new worktree or same-worktree tab (optional `agent`; `model` only when needed — otherwise Auto); `fork_chat` also forks Global orchestration chats (for remote coordinators continuing after session limits)
- Orchestration session-limit failover — on provider session/usage limit, auto-continue on another agent (Auto) or wait until reset (Settings → Advanced)

### Fixed

- Session/rate-limit failures show in the agent bubble without a redundant `exit 1` footer (orchestrator and worktree)

## [0.1.44] - 2026-08-09

### Added

- MCP `request_review` — orchestration agents can start a merge-readiness Review on a worktree thread (same as the desktop Review button)

### Fixed

- HTML artifact preview no longer goes white when clicking links (external links open outside the iframe)

## [0.1.43] - 2026-08-08

### Added

- Conductor-style thinking **effort** with 5 levels (`low` / `medium` / `high` / `xhigh` / `max`) on composer, agent picker, and Settings → Account defaults (agent → effort → plan)
- Click the composer effort chip to pick a level (no model modal); effort in the agent picker applies immediately

### Changed

- Settings opens on the Account tab by default
- Create modal Plan chip shows the **Plan** label beside the icon (same as thread composer)

### Fixed

- Renderer white screen from importing Node-backed `@sideboard-ai/core` values into the UI (effort helpers stay local)

## [0.1.42] - 2026-08-08

### Changed

- Review request instructions require an explicit merge-readiness recommendation (Approve / Approve with nits / Request changes), not findings alone
- Opening an artifact / schema / files panel no longer closes the right sidebar
- Review no longer auto-creates or attaches `Review request.md`; customize guidelines is opt-in from the Review menu
- Git sidebar actions send short chat prompts (`Commit and push.`, `Commit, push, and open a draft PR.`, …); the worktree core prompt expands them

## [0.1.41] - 2026-08-08

### Fixed

- Orchestration chat layout keeps the Queued dock + composer in view; fleet bar shows coordinator/child queue counts
- Review opens a new chat tab instead of sending into the current one
- Cursor `Agent … not found` on resume starts a fresh session instead of failing with exit 1

## [0.1.40] - 2026-08-08

### Fixed

- Orchestration turns no longer get false `Process died (reconciled on startup)` when Sideboard MCP (or other helpers) reconcile mid-turn
- Cursor orchestration `exit 1` with an empty reply: recover the finished cloud run from the local SDK store when the runner drops mid-stream
- Follow-ups on a live agent (including orchestration / Cursor) stay in the message queue until the turn actually finishes, instead of overlapping

## [0.1.39] - 2026-08-08

### Added

- Large composer pastes become `Pasted text #N.txt` file attachments instead of flooding the input

### Changed

- Attachment chips, composer focus, and chat table/streaming accents are quieter; user messages use the same accent family as Draft / Archive

### Fixed

- Tool chips no longer show fake `+/-` counts from JSON numbers in MCP tool results
- Settings and other modals no longer sit behind the message composer

## [0.1.38] - 2026-08-08

### Fixed

- Cursor agent turns in the packaged desktop app no longer fail with `MODULE_NOT_FOUND` when spawning the SDK runner from `app.asar` via system Node

## [0.1.37] - 2026-08-08

### Fixed

- Creating a worktree from a GitHub PR no longer fails with `invalid reference: sideboard-pr-N` when the PR head fetch previously failed silently

## [0.1.36] - 2026-08-08

### Added

- Settings → Account default agent and model for Create and new chat tabs

### Changed

- Run script Configure opens `.sideboard` / `.conductor` settings in Sideboard file tabs instead of an external editor

## [0.1.35] - 2026-08-08

### Changed

- Right sidebar open/closed and width, plus artifact column width, are remembered per worktree
- Right sidebar git/action labels stay text until the pane is genuinely narrow (compact below 280px)

## [0.1.34] - 2026-08-08

### Changed

- Right sidebar open/closed state is remembered per workspace (repo), falling back to the last global preference

## [0.1.33] - 2026-08-08

### Fixed

- Agent failures (Claude session limits, auth, credits, Codex/OpenCode/Brightsy/Cursor errors) now surface readable `lastError` text instead of bare `exit 1` / `[object Object]`
- Streaming in one chat no longer scrolls other chats in the workspace to the bottom
- Desktop Stop preserves the message queue and kills run-script process groups (Electron children no longer orphan)

### Added

- Queue editing / send-now controls; queued messages docked above the composer
- Per-thread panel isolation for right-column / artifact state
- Orchestration chats send the goal as the first turn; archive-all from the sidebar

### Changed

- Chat typography closer to Cursor (brighter text, 14px body)
- Right sidebar refreshes diff / PR meta when a turn finishes

## [0.1.0]

- Initial private pre-release (CLI, MCP, desktop board, agent adapters)

## Docs / process (ongoing)

### Added

- Contributing guide, agent adapter docs, remote integration docs, compare notes
- CI workflow (core/CLI build + typecheck + test + CLI smoke; desktop typecheck)
- Security policy
