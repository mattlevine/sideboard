# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.80] - 2026-08-16

### Added

- Public Slack landing, privacy policy, and support pages at `/slack/`, `/privacy/`, `/support/` on www.sideboard.cloud

### Changed

- Mac desktop ships Apple Silicon (arm64) only; Intel (x64) DMG/zip dropped from the electron-builder targets
- Orchestration first-turn prompt is audience + workspace inventory only; fleet playbook stays in `AGENTS.md` / `CLAUDE.md`

### Fixed

- Codex token badge no longer double-counts cache reads (`cached_input_tokens` is already inside Codex `input_tokens`) or reasoning (`reasoning_output_tokens` is already inside `output_tokens`)
- Brightsy token badge no longer double-counts `prompt_tokens_details.cached_tokens` (same OpenAI-shaped usage as Codex)
- Identical `AGENTS.md` / `CLAUDE.md` bodies are ingested once

## [0.1.79] - 2026-08-14

### Added

- Static marketing site (`site/index.html`, `site/docs/index.html`) at https://www.sideboard.cloud, served by the Slack relay Fly app. `relay.sideboard.cloud` stays Slack + `/health`.
- Account → GitHub git-auth modes: auto / gh / SSH / PAT (no third-party GitHub App), so agents and remotes use the same path

### Fixed

- Creating a worktree keeps the same processing overlay as archive until the first chat message appears, so the new chat no longer looks empty (as if you need to retype).
- `git push` from the desktop and worktree agents falls back to HTTPS via `gh` when the SSH agent is missing (same path fetch already used). Sidebar Create PR / Commit & push run that push themselves when the tree is clean.
- Nested Electron/Play launches strip inherited `ELECTRON_*` / `CHROME_*` so this repo's desktop `dev` does not kill the child GPU process

## [0.1.78] - 2026-08-14

Fresh signed Mac desktop and npm packages of current main (Linear MCP write tools, awake wordmark badge).

## [0.1.77] - 2026-08-14

### Added

- MCP Linear ticket tools: `linear_list_teams`, `linear_get_issue`, `linear_create_issue`, `linear_update_issue`, `linear_comment` (Account OAuth). Reconnect Linear if you connected before write access.
- Awake badge next to the Sideboard wordmark when caffeinate is on (chat hold or Settings)

### Changed

- Linear OAuth requests `read,write`. Desktop Connect uses Chromium networking so VPNs/proxies that break Node `fetch` still reach `api.linear.app`.

## [0.1.76] - 2026-08-14

### Added

- Orchestration chats show an **awake** chip on the tab while caffeinate is on (chat hold or Settings). The Mac dock and menu bar show a yellow status dot.
- Repo `AGENTS.md` / `CLAUDE.md` point at `docs/system/` for agents working on this codebase.

## [0.1.75] - 2026-08-14

### Changed

- Slack **Add via browser** exchanges the OAuth code on the hosted relay. The Slack client secret is no longer in git or the desktop app (set `SIDEBOARD_SLACK_CLIENT_SECRET` on the relay).
- Hosted relay hostname is `relay.sideboard.cloud` with Slack under `/slack/…` (OAuth `https://relay.sideboard.cloud/slack/callback`, desktop `wss://relay.sideboard.cloud/slack/desktop`).

### Fixed

- Slack Listen actually registers this Mac on the relay (Node `ws` DNS lookup now returns the address list Happy Eyeballs expects), so DMs and @mentions reach Sideboard
- Orchestration `set_caffeinate` hold is released when that chat is closed/archived (and when Sideboard quits), so a self-caffeinated coordinator cannot leave the Mac awake
- Queued-message Send now / Edit / Remove buttons work on the first click (composer collapse no longer steals the mouseup)

## [0.1.74] - 2026-08-13

### Added

- Orchestration MCP `ask_git` — tell a worktree agent to commit & push, open a draft PR, resolve conflicts, or merge. The worktree agent runs git/gh; the orchestrator only queues the prompt.

### Changed

- Orchestrators may ask a worktree agent to commit, push, and merge (`ask_git` / `send_to_thread`); they do not merge themselves. `confirm_land` and `purge_thread` stay human-only

### Fixed

- Context meter uses the last API request’s prompt size (input + cache), not billed tokens summed across every tool round in the turn
- Right sidebar git button shows **Merge** (not **Commit & push**) when the working tree is clean: the Changes list vs trunk is not treated as local dirt
- Archive/git hover cards wrap long PR titles instead of stacking them on one line

## [0.1.73] - 2026-08-13

### Added

- Orchestrator Slack outreach: when `slack_post` messages someone else, their reply is relayed into that orchestration chat (and FYI’d back to your Slack thread if you were talking there). It is information only — it does not start a turn or count as a command. The next user turn includes those replies in the prompt so resume still sees “Sean said …”.

## [0.1.72] - 2026-08-13

### Added

- Slack **Add via browser**, Linear **Connect via browser**, and agent **Log in** have Cancel (closing the browser/Terminal no longer leaves Settings hung)

### Changed

- Slack OAuth redirect is HTTPS (`https://slack-relay.sideboard.cloud/callback`) so the app can be publicly distributed; the relay bounces to localhost
- Slack settings note that the install page stays on the app’s home workspace (Brightsy) until Public Distribution is on

## [0.1.71] - 2026-08-13

### Added

- Context meter (circular fill) next to the token counter — latest-turn context vs estimated model window
- Slack orchestrator replies: use Slack mrkdwn (`*bold*`, not `**markdown**`) — formatting guide in the Slack audience prompt and every Slack inbound turn

### Fixed

- Slack relay: tolerate older relay `registered` / `event` payloads; fall through if `claim_ok` never arrives

## [0.1.70] - 2026-08-13

### Added

- PR pill, git hover card, Checks, and stack map show **Queued** when the connected GitHub PR is in a merge queue (`isInMergeQueue`)
- Slack workspaces connector (Account settings): store N team tokens, MCP `list_teams` plus `slack_list_channels` / `slack_search` / `slack_read` / `slack_post`
- Slack Listen via the official Sideboard app + hosted relay: DMs and @mentions route to the Global orchestrator; each Mac is a named destination (`Personal` / `Work`); address with `work:` / `personal:` (case-insensitive); replies are signed with that name so you can tell which Mac answered
- Sidebar badge when someone replies in Slack to a message Sideboard posted (`slack_post`); click opens that thread. Their reply does not drive this Mac.
- Orchestration MCP `set_caffeinate` — keep this Mac awake across Slack / away-from-keyboard turns; turn off when the user says they are done

### Changed

- Linear Account connection uses browser OAuth (PKCE) instead of requiring a personal API key. Paste-a-key still works as a fallback. `sideboard linear login` / `disconnect`
- Diff view no longer shows a loading preloader; the patch appears when git is done

## [0.1.68] - 2026-08-12

### Changed

- Opening a file in Changes Diff is a single `git diff --no-ext-diff` for that path (no merge-base round-trip, untracked walk, or external diff tool)
- Changes file list paints tracked files first, then badges and untracked paths
- Git commands used for diffs run with `--no-pager` so a configured pager cannot stall the panel

## [0.1.67] - 2026-08-12

### Added

- Detect Conductor-bundled Claude/Codex at `~/Library/Application Support/com.conductor.app/bin` (fallback after Homebrew/npm)

### Changed

- **Inject Brightsy MCP on Claude, Codex, and OpenCode** lives in Settings → Advanced (not Agents → Brightsy); still off by default
- Install skips `npm i -g` when the CLI is already on PATH, including Conductor’s copy
- Agent Log in polls until auth is detected instead of returning as soon as Terminal opens

## [0.1.66] - 2026-08-12

Desktop GitHub release of the 0.1.65 Brightsy MCP gating (fresh npm + Mac DMGs).

## [0.1.65] - 2026-08-12

### Added

- Settings → Agents toggle **Inject Brightsy MCP on worktree agents** (off by default). When on, Claude / Codex / Cursor / OpenCode worktree chats always get Brightsy MCP if logged in

### Changed

- Worktree agents no longer inject the full Brightsy MCP catalog on every turn. They get it when the user names Brightsy (“use Brightsy to…”), after the thread already used it or opened a Brightsy CMS pane, or when the setting above is on. Orchestration chats still get it whenever logged in

## [0.1.64] - 2026-08-12

### Changed

- Worktree agent turns inject a UI-only Sideboard MCP (present_artifact / schema / files / plan, ask_user) instead of the full 35-tool fleet catalog
- Codex, OpenCode, and Cursor resume omit the worktree/artifact/AGENTS.md prefix (same as Claude `--resume`)
- `present_*` MCP tool results return id + ok only — document/schema bodies stay on the tool input so they are not billed twice

## [0.1.63] - 2026-08-12

### Added

- Custom executable path overrides for Codex, OpenCode, and Brightsy (Settings → Agents), matching Claude Code
- IPC helpers to browse / resolve system CLI binaries for all supported agents

### Fixed

- Codex (and other npm-global CLIs) login/install Terminal windows now use an absolute binary path and export Electron’s PATH, so `codex login` works when Terminal’s shell PATH lacks the npm global bin

### Changed

- Right-sidebar header tints for all PR states (open / draft / review / conflicts / closed / merged), not only merged
- Left sidebar no longer fills merged worktree rows purple (PR state color stays on the hover-card button)

## [0.1.62] - 2026-08-12

### Added

- Conductor-style merged PR UX: purple sidebar rows + purple right-sidebar header, cached `prState`, and light follow of open PRs (focus + every 60s)
- Optional **Auto-archive on merge** (Settings → Advanced; **off by default**)
- Worktree hover card shows live GitHub PR lifecycle (`#N` + Open / Draft / Merged / review state) with the same Create PR button shape

### Changed

- Right-sidebar header is shorter; PR control matches Archive / Continue button height and corner radius

## [0.1.61] - 2026-08-12

### Fixed

- Orchestration `create_thread` cap no longer counts archived/deleted children — clearing tabs frees slots again

## [0.1.60] - 2026-08-12

Rebuild + release of the 0.1.59 orchestration MCP / Codex fixes (fresh npm + desktop artifacts).

## [0.1.59] - 2026-08-12

### Fixed

- Orchestration MCP always inherits `SIDEBOARD_APP_DATA` (Claude / Cursor / Codex / OpenCode) so `create_thread` writes into the same store as desktop `pnpm dev` (`.sideboard/dev-app-data`) instead of a separate `~/Library/.../sideboard` tree children never appear in
- Codex orchestration: `--skip-git-repo-check`, `approval_policy=never` (no rejected `--ask-for-approval`), non-blocking detect (no nested `codex login` / `mcp list`), and injected `SIDEBOARD_ORCHESTRATOR_THREAD_ID` so inventing stale `parentThreadId`s cannot hang or mis-nest children
- `create_thread` no longer remaps unknown parents onto a random live orchestration chat; bind via env / a real parent id only
- Coordinator `AGENTS.md` / `CLAUDE.md` embed the orchestration thread id and keep it across reconcile rewrites; turn reminders tell agents to omit or pass that id
- Git worktree create / fetch timeouts so a stuck fetch cannot pin MCP stdio forever; `create_thread` hard timeout (90s)
- Nested Codex-under-Codex from `create_thread` is coerced to a non-Codex Account default agent

### Changed

- Review sends **Review changes in this workspace.** (was **Review.**)
- Left sidebar: hovering a worktree row opens the git status hover card; edit (✎) icon removed
- Narrow composer toolbars hide chip labels (icons only) so model / effort / Plan stay usable in skinny panes

## [0.1.58] - 2026-08-11

Desktop GitHub release only (npm stayed at 0.1.57). Functional fixes above ship in **0.1.59**.

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
