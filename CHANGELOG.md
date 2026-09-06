# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.159] - 2026-09-06

### Changed

- Account and project **roles** are no longer a separate Settings control. Write roles into **Account context** (Settings → Agents) and **Project context** (Settings → Projects). Leftover checkbox roles fold into that text on read.
- Orchestration and worktree agents can update that context via `get_viewer_context` / `update_viewer_context` after `ask_user` confirms. Project updates from orchestration require `repoPath` from `list_workspaces`.

## [0.1.158] - 2026-09-05

### Added

- Worktree agents get MCP `wait_for_job` (45s / `stillRunning`, same contract as `wait_for_turn`) so Claude can poll detached tests instead of ending the turn with “I’ll let you know.” If a turn still ends while a detached job is running — or the last text promises to report later with no job — Orchestrator queues a continue.

## [0.1.157] - 2026-09-05

### Added

- Worktree agents can read comments, add comments, update status, and create spin-off issues on Linear, GitHub, and AbleTime using Sideboard Account tools (`linear_*`, `github_*`, `abletime_*`). Vendor issue MCPs that show needsAuth are ignored.

### Fixed

- Core dts build accepts the worktree `github_*` / `linear_*` / `abletime_*` allow-list (`string[]`, not the UI-tool literal union).

## [0.1.156] - 2026-09-05

### Fixed

- Orchestration turns no longer wait on the user’s Linear (or other vendor) MCP. Claude uses `--strict-mcp-config` plus `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Codex `-c` disables user `mcp_servers` from `~/.codex/config.toml`. OpenCode sets those names `enabled: false` in `OPENCODE_CONFIG_CONTENT`. Cursor skips ambient `~/.cursor/mcp.json` (`settingSources: []`). Find-work uses Sideboard `list_issues` / `linear_*`. Failed Claude MCP servers on `system/init` show as thinking. A follow-up still steers (default) and continues the request. Worktree agents still merge the user’s MCP list. Brightsy has no local MCP injection.
- Cursor orchestration `settingSources` is typed as `LocalAgentOptions['settingSources']` so `pnpm --filter @sideboard-ai/core build` type-checks (`[] as const` was not assignable).

## [0.1.155] - 2026-09-05

### Changed

- Marketing site and docs headline the find-work flow as **Contextually aware**.

## [0.1.154] - 2026-09-05

### Added

- Marketing site and docs describe the contextually aware find-work flow (Settings → Agents / Projects roles and notes; “find me some work” lists, “find me work and start it” starts).

### Fixed

- Creating several worktrees at once no longer paints a red setup error on the new chat tabs. Automatic setup after create stays in the Setup panel; a queued first prompt is treated like an in-flight turn.

## [0.1.153] - 2026-09-05

### Added

- MCP `list_prs` can find the review inbox: `queue=review` is open non-draft PRs labeled `eng-review` with no individual user reviewer (the “get me N tickets to review” path — PRs for assigned ticket work). A team request such as `engineering-team` is not a claim. Settings → Agents has a multi-select **Your roles** plus notes for how to find tickets and review PRs (check Engineering, Design, and/or Product, or add another — no combined “both” value). Settings → **Projects** can override roles and add notes per repo. Orchestration uses that profile when you ask it to find work (lists options) or “find me work and start it” (creates worktrees). Also `state`, `label`, `reviewer` (`me` / `unassigned` / login). Same compact page as `list_issues` (default 40, max 250, `truncated`).

### Changed

- MCP `list_issues` / `linear_search_issues` return a compact first page (default 40, max 250) with `truncated`. Pass `query` and/or a higher `limit` to search beyond 40. Linear and AbleTime mutation tools register only when connected. `list_linear_issues` is removed.

### Fixed

- New worktrees show `[scripts] setup` in the right-sidebar Setup tab: the pane opens while setup runs, output is persisted so a late mount still replays the log, and a worktree `settings.toml` that only defines run scripts still inherits `setup` from the main checkout (`.sideboard` or `.conductor`).
- Creating from a ticket, PR, or named branch that already has a live worktree reuses that checkout (including PR ↔ head-branch). The Create-from picker marks those rows Already open and does not allow a second worktree.

## [0.1.152] - 2026-09-04

### Changed

- Review no longer seeds `.claude/skills/review/SKILL.md`. If that skill already exists, Review and Customize use it; otherwise Sideboard copies `.sideboard/review.md` into the worktree `.context/review.md` (or seeds that file from the stock template).
- If a goal is given (Greptile 5/5, CI green), worktree agents watch-fix-push until it lands. They do not start that loop after a plain push. MCP `get_pr_checks` is a snapshot.

## [0.1.151] - 2026-09-04

### Changed

- Detached long-job logs live under `.context/.sideboard/detached-jobs/` (workspace scratch). Wait/status still find a legacy `.sideboard/detached-jobs/` job.

## [0.1.150] - 2026-09-04

### Added

- Settings → Agents → Follow-up behavior (Steer or Queue, default Steer). Steer skips the composer queue and starts the follow-up immediately, the same as Send now.
- Issue search can find unassigned tickets and other people's work (`assignee`: me / unassigned / all / user). Linear MCP `linear_search_issues` and `list_issues` gain `query` + `assignee`.

### Fixed

- Actions Mac pack imports the Developer ID `.p12` into a runner keychain instead of handing `CSC_LINK` to electron-builder. macOS 26.6 rejects electron-builder's `set-key-partition-list` call (it unlocks with the p12 password). Re-pushing the same `v*` tag skips npm versions that are already published.
- `ask_git` can push when origin is SSH: stored remotes stay `git@`, and the process retries over HTTPS via `gh` when ssh-agent is missing.
- `ask_git` / `gh pr create` GraphQL “body is too long” is returned as a short `lastError` so the agent can retry with a brief `--body-file`. Sideboard writes the body via `--body-file` and clamps generated descriptions.
- Coordinators no longer report a stopped child as “Agent is running. Waiting for gate to pass.” `stillRunning` requires a live handle, pid, or queue — leftover disk `running` is healed.
- Worktrees ignore `.sideboard/` (`$GIT_DIR/info/exclude` + skip-worktree) so agents cannot commit Sideboard scratch.

## [0.1.149] - 2026-09-03

### Fixed

- Cursor turns that fail at create/resume/send with a retryable SDK network error (`Network request failed`) are retried once in the runner, then respawned once by the orchestrator. Claude, Codex, OpenCode, and Brightsy still rely on their own CLI retries.

## [0.1.148] - 2026-09-03

### Added

- `linear_get_issue` returns comments, relations (blocks/blockedBy/related/duplicate), parent/children, project, estimate, due date, attachments, and other ticket metadata. Assigned-issue lists stay slim so Linear's query-complexity cap does not fire.

### Fixed

- Core package build no longer fails TypeScript when mapping Linear comments and attachments.

## [0.1.147] - 2026-09-02

### Added

- Right-sidebar PR pill splits into `#N` / status (opens the in-app PR tab) and `↗` (opens GitHub). Merged / Closed / Queued stay visible at the default sidebar width.
- Files, folders, and selected code can be added to chat as `code-ref` attachments (`@` on a listing, or a selection in the editor).

## [0.1.146] - 2026-09-02

### Fixed

- New worktrees fetch `origin/<branch>` (same HTTPS fallback as push) before `git worktree add`, so they start from the remote default-branch tip. If the project folder is on that default branch and clean, create also fast-forwards it (`merge --ff-only`). Dirty or off-branch checkouts are left alone.

## [0.1.145] - 2026-09-02

### Added

- Right sidebar **Ready for review** on a linked draft PR when the working tree is clean and `origin/<branch>` has every local commit (`gh pr ready`). Merge stays in the overflow menu.

## [0.1.144] - 2026-08-31

### Fixed

- Workspace setup no longer paints `Setup exited 1` over a live Claude turn. Setup still logs in the Setup panel; lastError is reserved for idle threads. Chat, sidebar, and board hide lastError while status is `running`.

## [0.1.143] - 2026-08-30

### Fixed

- Brightsy worktree chats seed from the last successful `summarize_context` tool plus every later turn, instead of a last-6-message cap. Sideboard `role: 'summary'` compaction is not the cutoff.

## [0.1.142] - 2026-08-30

### Fixed

- Disconnecting PostHog or Sentry now clears the stored host so `POSTHOG_HOST` / `SENTRY_URL` are not left in agent env.
- Linear and Slack browser sign-in no longer cancel when switching Settings sidebar items. Closing Settings still cancels an in-flight flow.
- Connect Cancel on Settings → Connectors closes the form after a token has been typed.
- Actions Mac pack raises the Node heap so `electron-vite` can finish on `macos-latest`. Re-pushing the same `v*` tag skips npm versions that are already published.

## [0.1.141] - 2026-08-29

### Added

- `/long-running` is a Sideboard product skill for every worktree agent (not only this repo). Fresh sessions get the detach-and-wait playbook; each turn repeats the helper path. Packaged apps ship `scripts/detached-job.js` next to Sideboard MCP.

## [0.1.140] - 2026-08-29

### Added

- Settings panels for Git, Issues, Remote (Slack), and Connectors (Vercel, Supabase, PostHog, Sentry). Default agent/model/effort lives at the top of Agents. Slack is Settings → Remote.
- **Install CLI** on Connectors when `vercel`, `supabase`, or `sentry-cli` is missing (`npm i -g`, Terminal fallback). Does not auto-install on Connect. PostHog stays HTTP-only.

### Changed

- Removed the Account settings panel. Settings opens on Agents. User-facing paths now say Settings → Git / Issues / Remote / Connectors.

### Fixed

- Chat tabs-bar token text matches the worktree hover card: muted billed `X tok`, no occupancy `/ 1M` ratio or warn/hot colors.
- Agent-message context ring stays a muted meter: billed-turn totals over 1M no longer paint a full red ring. Live elapsed time ticks even if `turn_started` is late.
- Chat tabs-bar again shows the fixed 1M context window (muted ring + `X / 1M`).
- Tabs-bar warn/hot colors follow going-forward occupancy (remaining transcript / last request), not billed chat totals.

## [0.1.139] - 2026-08-29

### Fixed

- Worktree agents no longer look like they “stopped mid-thought” when the parent archives them, or when the coordinator `force_stop`s to “resume.” Halt notices fire only for an unexpected in-flight death. A stale on-disk `agentPid` no longer SIGTERMs a live Cursor/Claude runner.

## [0.1.138] - 2026-08-29

### Fixed

- Chat tabs-bar meter shows next-request occupancy (with warn/hot colors), not the billed thread Σ.
- Orchestration `list_threads` / `get_thread` / `wait_for_turn` see live worktree status again (MCP no longer keeps a stale in-memory cache). `get_thread` lists child agents and last message text.

### Changed

- “Create a new release” always means Electron + build npms (human publishes) + README/marketing + commit/push + Fly deploy if the site changed.
- Marketing homepage: crop the board shot flush to the window and place the worktree-chat shot after the three pillars.

## [0.1.137] - 2026-08-29

Desktop pack only; superseded by 0.1.138.

## [0.1.136] - 2026-08-28

### Fixed

- After `ask_user`, the sent answer in the user bubble renders markdown.
- Create / Orchestration modal drops persist file bytes into `.context/attachments/` so the agent can Read them.
- When a worktree child dies or is stopped, the parent orchestration chat gets a follow-up and `wait_for_turn` no longer looks like success.
- Chat tool rows no longer show a clipped worktree-root path pill. Searches show the pattern instead of the folder.

### Changed

- Marketing homepage hero now shows the global board above the worktree-chat screenshot.

## [0.1.135] - 2026-08-27

### Fixed

- Archive confirm stays clickable while another worktree is tearing down. The processing pane is an Electron window-drag region; confirm modals are now `no-drag` so the click hits the button instead of moving the window.

## [0.1.134] - 2026-08-27

### Added

- AbleTime as an issue source via hosted MCP (Settings, create-from, `list_issues`).

### Fixed

- Fan-out across several worktrees no longer freezes sidebar and board clicks. Live streams stay off the shell; transcript reloads and git-diff polls are coalesced.
- Empty Home board no longer shows the kanban explainer.

## [0.1.133] - 2026-08-26

### Changed

- Left sidebar sort is a sort icon next to the Projects filter, instead of a labeled dropdown above Orchestration.

## [0.1.132] - 2026-08-26

### Added

- Home and the left sidebar can sort worktrees by **Created** (default), **Name**, or **Recent activity**. Created keeps the list still while agents run.
- Left sidebar nav (and the board page title) say **Board** instead of Home, with a three-column Kanban glyph.

### Fixed

- Composer auto-focus after a turn only runs in the open chat, and does not steal the caret from another field.
- Chat autocomplete and the Files tab no longer re-walk the worktree on every agent token (that was janking the UI while turns ran).
- Right sidebar **Open :port** (Run) opens the app in the default browser, not a Sideboard URL tab.

## [0.1.131] - 2026-08-26

### Fixed

- Queue: more than one follow-up can sit while a turn is running. **Send now** starts the next message immediately instead of waiting for unwind or a full refresh.
- Brightsy MCP: refresh the OAuth access token when expiry is missing or about to lapse, instead of prompting login again.
- Agent crashes: the orchestrator feeds the error back as a follow-up turn (all agents) so the run can recover the way Cursor does.

### Changed

- Queuing a follow-up no longer flips a live running thread to queued.
- Brightsy MCP injects `BRIGHTSY_REFRESH_TOKEN` so the host can refresh without a new login.

## [0.1.130] - 2026-08-26

### Fixed

- Linear `listIssues` no longer fails with `Query too complex`. The assigned-issues query dropped nested `team.states` and capped `labels` so it stays under Linear’s 10k/query cap.
- Create-from Linear defaults to **Assigned to me** (same as Conductor). **This cycle** remains as an optional tighter filter.

### Changed

- Worktree agents detach **any** long job and wait in slices (`scripts/detached-job.js` start / wait) so a new chat turn does not SIGTERM the process. `present_artifact` **`type=log`** appends new lines (`delta`) to the same pane — do not resend HTML. Mac pack/notarize uses the same tool.

## [0.1.128] - 2026-08-26

### Fixed

- Home Merged **Archive worktree** sits under the worktree name (full-width, no extra card), not beside the title and not on a nested chat.

## [0.1.127] - 2026-08-26

### Added

- Home **New orchestration** starts a Global orchestration chat (same as the sidebar Orchestration +).

### Changed

- Home / `list_board` show one card per worktree. Sibling chat tabs nest as inner cards (title, preview, Stop). More than three chats scroll inside the worktree card. Archive stays on the worktree.
- Default **Max concurrent agents** is 5 (was 3).
- Home / `list_board` columns are **New → Draft → Review → Merged** (no PR, draft PR, open PR, landed). Archive stays on Merged.
- Home Merged **Archive worktree** archives the checkout (every chat tab), not a single inner card.
- Home Kanban worktree cards use the same status icons as the left sidebar; nested chats keep status dots. Clicking the worktree wrapper opens that checkout.

### Fixed

- Sidebar multi-select ring uses the row border (not an outside outline) so the left/right edges are not clipped.
- Plan `ask_user` questions stay put after you answer in the picker or the normal composer — they no longer remount when the tool id is persisted.
- Desktop pack in a Sideboard worktree finds `@cursor/sdk` (stage from `packages/core`, not the repo root).

## [0.1.126] - 2026-08-25

### Added

- Orchestration MCP `list_board` / `start_board_card` — same Home Kanban as desktop (tickets, unmatched PRs, thread columns). Worktree MCP profile stays UI-only.
- Home / `list_board` ticket scope: Linear defaults to issues assigned to you in the current cycle; toggle All assigned. GitHub can filter Assigned to me.
- Home / `list_board` cache tickets and PRs for 15 minutes. Refresh or `list_board refresh=true` pulls Linear/GitHub again; threads stay live.
- Home / `list_board` show every worktree chat (sidebar Create, board Start, or orchestration `create_thread`). Orchestration chats stay in the sidebar.
- Home is a Kanban of worktree chats. Sidebar Create and `create_thread` put a card on Home. Columns are the path to merge: In Process (no open PR) → Review (open PR) → Merged. Archive removes the card to Settings → History. Queued/running stay on the card. Orchestration chats stay in the sidebar. Removed MCP `add_to_board` (it was a second create).
- Create (sidebar, `create_thread`, `start_board_card`) reuses a live worktree when the ticket, PR, or named branch is already checked out. Default-branch create still opens a new isolated worktree. `fork_worktree` / best-of-n still force a new checkout.
- Home cards: Archive only on Merged (same confirm as the sidebar; last tab tears down the worktree). Archived chats live in Settings → History, not on Home.

### Fixed

- Chat and Create composers focus after a file drop. The chat input also focuses when a running or queued turn ends.

## [0.1.125] - 2026-08-25

### Removed

- Sidebar Slack reply badges and all badge plumbing (`SlackReplyBadge`, IPC, unread state). Replies still poll in the main process and land in the posting chat with a follow-up turn.

## [0.1.124] - 2026-08-25

### Fixed

- `slack_post` reply watching polls with the bot token so bot↔user DM replies are visible (`channel_not_found` on the user token).
- **Settings → Advanced → Show cost (when available)** only displays provider-reported USD (no Cursor token estimates). Cursor turns still poll `agent.getUsage()` when the billing API is available for the account.

## [0.1.123] - 2026-08-24

### Changed

- Desktop GitHub release of the 0.1.122 Show cost + sidebar archive control work (fresh Mac DMG / zip).

## [0.1.122] - 2026-08-24

### Added

- **Settings → Advanced → Show cost** (off by default): provider-reported USD on message chips, the thread Σ total, and worktree hover spend. Tokens still show either way; Codex never reports USD.
- Cursor turns fold turn-scoped USD from `agent.getUsage()` after `run.wait()` when the stream is tokens-only.

### Fixed

- Sidebar archive control is the ▤ button only — no hover preview card.

## [0.1.121] - 2026-08-24

### Fixed

- Orchestrator `slack_post` replies start a follow-up turn on the posting chat. They stay information only (not commands, and they do not interrupt an in-flight turn the way Slack Listen inbound does).

## [0.1.120] - 2026-08-24

### Fixed

- Chat groups thinking and tool work that happen with no agent text between them into one timed “Worked” block, instead of a stack of empty Thought / Worked headers.

## [0.1.119] - 2026-08-24

### Changed

- Chat turns interleave thought, mid-turn text, tool work, and the outcome in chronological order, instead of collapsing all thinking and tools into one block above a single reply.

## [0.1.118] - 2026-08-23

### Fixed

- Concurrent Cursor chats no longer share one JSONL catalog. Each thread writes `cursor-sdk-store/threads/<threadId>/`, and a missing `Run … not found for agent …` row starts a fresh session instead of failing the turn.
- Running several agents at once no longer freezes board navigation. Live `*.live.json` sidecar writes no longer trigger a full thread-list reload, tool tails no longer re-parse every transcript on the main thread, and the chat UI paints stream tokens once per animation frame.

### Changed

- Expanded thinking shows the full stream in a scrollable pane (pinned to the latest line while it runs) instead of a 280-character tail.

## [0.1.117] - 2026-08-23

### Changed

- Chat only shows the live shell log after a command has been running for a few seconds. Short `ls` / `git status` calls stay a one-line row; click still opens the inspector.
- Streaming turns show the brand mark and bouncing dots from the moment you send, including the wait before the first token.
- Live Thinking / Working labels use a wave across the word; the duration sits next to them only after the turn finishes. A chevron appears on hover.
- Agent messages always show the elapsed-time chip in the footer again (`12s`), including while thinking/tools are visible.

## [0.1.116] - 2026-08-23

### Added

- Chat shows a Cursor-style live log under running shell tools. Codex streams `aggregated_output` while the command is in progress; Claude, Cursor, OpenCode, and Brightsy use the same pane when their CLI emits output (often when the command finishes). Click still opens the inspector.

### Changed

- Agents are told not to also call `present_schema` just to re-display a markdown table. If the user then asks for an editable / interactive table, `present_schema` is still the right tool.

## [0.1.115] - 2026-08-23

### Changed

- Chat turns follow Cursor’s layout: thinking is a collapsed “Thought briefly” line, the reply stays visible, and tools summarize in a muted footer (`Edited …, 1 search`) instead of a live activity ticker. Click a tool row or chip to open the inspector.

### Fixed

- Chat no longer repeats live activity as a second status line under a streaming turn (or in the turn header). The bubble keeps the previous mark + dots; MCP `wait_for_turn` still gets the richer snapshot.

## [0.1.114] - 2026-08-22

### Fixed

- Claude Code headless turns can poll background Agent/Task children: auto-approve `TaskOutput` / `TaskStop` / `EnterWorktree`, keep `system/task_*` as live progress instead of stealing `--resume`, and wait 2h (not 10m) for those children. Codex and OpenCode no longer treat nested/child start events as the parent session. `wait_for_turn` says when a child is still queued on the concurrency cap.
- Chat shows a live activity line under a streaming turn (current subagent / tool / wait), including Claude background Agent polls (`task_notification`) and queued-but-not-started children.

## [0.1.112] - 2026-08-22

### Fixed

- Agent turns raise V8 `--max-old-space-size` to 8 GiB via `NODE_OPTIONS` (Claude Code, Codex, OpenCode, Brightsy, Cursor, and injected Sideboard MCP). Large project folders were hitting the default JavaScript heap.
- V8 JavaScript-heap OOM on a live session is retried once with a fresh chat (same path as a dead runner). First-turn indexing OOM is not retried.

## [0.1.111] - 2026-08-22

### Fixed

- Queued follow-ups sit inside the composer (same width) on worktree, cowboy, and orchestration chats, including file/diff overlay, instead of a separate full-bleed dock the overlay could cover.
- Idle sends (agent not streaming, no follow-ups) paint in the transcript. The composer queue is only for messages waiting behind a live turn or parked after Stop.
- Cowboy chats no longer show a “Creating worktree” overlay while the first prompt is queued. Queued messages match user-bubble layout (radius, type size, wrapping).
- Packaged Cursor `uv_run` abort stacks from bundled official Node are no longer labeled as Homebrew libuv (`brew install node@22`). V8 JavaScript-heap OOM (common when the local agent indexes a large project folder) is summarized as such and is not retried.
- CJS core/MCP builds no longer warn on empty `import.meta` when lazily loading `better-sqlite3` or resolving bundled ripgrep.

## [0.1.110] - 2026-08-22

### Added

- Cursor Task / Agent subagent turns stream inner thinking and tools into the board (nested card under the parent tool), matching the Cursor app’s nested transcript more closely.
- Claude Code Task / Agent subagent messages with `parent_tool_use_id` nest the same way. Turns set `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` and auto-approve `Task` + `Agent`.
- Codex `spawn_agent` (`collab_tool_call`) is a subagent card; OpenCode `task` / `subtask_*` events nest when the CLI emits them.
- Cowboy mode: Settings → Advanced unlocks chats that work in the project folder on the default branch (off by default). New chat → ⋯ → Cowboy, or CLI `--cowboy` / MCP `create_thread cowboy=true`. Land is commit+push. Archive does not delete the folder.

### Changed

- Orchestration home with no chats uses the empty-chat layout (centered prompt) and a New chat button instead of a blank board list.

## [0.1.109] - 2026-08-21

### Changed

- Worktree Sideboard MCP lists only the five UI tools (`present_*` / `ask_user`). Slack, Linear, and `list_workspaces` / `list_threads` / `get_thread` stay on the orchestration profile so coding turns do not pay the fleet tools prefix.
- Transcript compaction no longer drops the CLI session (prompt cache) unless last-request occupancy is at least 750k tokens. The board still summarizes older turns for the UI and for a later seed.
- Orchestration per-turn reminder is identity only (thread id + parentThreadId). The fleet playbook stays in `AGENTS.md` / `CLAUDE.md`.
- Claude Code and OpenCode turns opt into a 1-hour prompt-cache TTL unless `FORCE_PROMPT_CACHING_5M` / `OPENCODE_ANTHROPIC_FORCE_PROMPT_CACHING_5M` is set.

### Fixed

- Slack `•` lists in the board render as markdown lists. Conversion used to run only when the reply had an `<https://…>` link, so a bullet run with no URL collapsed into one wrapped paragraph.

## [0.1.108] - 2026-08-21

### Changed

- Slack Listen long-turn placeholder is `Thinking…` (same as in-app agent thinking), not `Working…`. Live tool names still replace that text on edit.
- Worktree setup seeds `.claude/skills/review/SKILL.md` when missing (copies `.sideboard/review.md` if present). Review attaches that skill so agents can customize merge-readiness per repo. Sideboard does not auto-commit it. Worktree prompts say creating that skill is allowed; the ban is `.sideboard/skills/` only, not `.sideboard/review.md`.

### Fixed

- Packaged Cursor and MCP actually run on the bundled official Node 22. `isElectronLikeCommand` used to match any path under `Sideboard.app`, so `Contents/Resources/node/bin/node` was skipped and Homebrew Current + Cellar libuv kept crashing the runner.
- Orchestrator `lastError` prefers `Cursor run failed:` (Connection stalled) over the in-process “unresumable checkpoint — starting a new session” note. Empty stalled turns are retried once.

## [0.1.107] - 2026-08-21

### Fixed

- Context meter always treats the window as 1M tokens (occupancy / 1M). ~346k on Cursor is ~35%, not red.

## [0.1.106] - 2026-08-21

### Fixed

- Slack coordinator replies keep Slack line breaks in the board (single newlines and same-line PR-link runs), matching how Slack wraps them.

## [0.1.105] - 2026-08-21

### Fixed

- Slack coordinator replies that use mrkdwn links (`<url|label>`) render as markdown in the Sideboard board instead of raw angle-bracket markup. Slack posting is unchanged.

### Changed

- Docs site Repo config is four cards (Worktrees, Setup, Review, Process skills) instead of one packed paragraph.

## [0.1.104] - 2026-08-20

### Added

- Local scheduled tasks that trigger orchestration agents (Settings → Schedules, `sideboard schedule`, MCP `create_schedule`). A due job sends a prompt to a named Global chat or starts a new one. Overnight runs opt in via **Settings → Advanced → Caffeinate while schedules are enabled** (default off) or `set_caffeinate`.

## [0.1.103] - 2026-08-20

### Added

- Slack Listen posts one editable `Working…` message after ~20s on a long turn and `chat.update`s it from the live tool snapshot. The final answer (or an interrupt) replaces or deletes that placeholder so DMs are not silent until the coordinator finishes.

## [0.1.102] - 2026-08-20

### Fixed

- Slack Listen JSON-pings the hosted relay every 20s and reconnects on a missing pong. A quiet Fly/NAT drop used to leave the Mac thinking it was connected while `/health` showed `sessions: 0`, so DMs were skipped even with Sideboard open (including an empty board).

### Changed

- README and marketing-site hero screenshot refreshed (`sideboard-desktop-review-v5.png`, `site/desktop.png`) at native 2830×1600 PNG so it stays sharp on retina.

## [0.1.101] - 2026-08-20

### Changed

- Left sidebar rows use glyphs instead of color-only dots: spinner (running), clock (queued), alert (error), git-branch (uncommitted), outline circle (idle). Running/error win over git dirty.

### Fixed

- Several worktrees can be archived at once. Sibling chat tabs still tear down the checkout once; `git worktree add`/`remove` on the same repo wait in line so overlapping archives do not fail on `.git` locks. The sidebar shows an Archiving spinner on every in-flight row.
- Orchestration `wait_for_turn` returns within 45s with `stillRunning` and a live tools/thinking snapshot instead of hanging until the MCP client kills the tool (~60s). Coordinators loop wait; they must not ping a busy worktree.
- `listThreads` ignores `threads/<id>.live.json` sidecars. Listing them as threads made `get_thread` throw `startsWith` of undefined and crashed the orchestration turn on branch sync (`replace` of undefined).
- Queued Send now / Edit / Remove land on the first press (`pointerdown`). A wedged agent child after Stop no longer pins `drainQueue` — Send now always arms drain, and a live `agentPid` is SIGKILL’d after 2.5s so the next message is not a no-op.

## [0.1.100] - 2026-08-20

### Changed

- `@cursor/sdk` 1.0.26 → 1.0.28 (local tool allowlists, browser login, local usage; engines.node `>=22.13`).
- Packaged Sideboard.app ships official Node 22 LTS (`Contents/Resources/node/bin/node`) for Cursor and MCP. Homebrew Current + shared libuv is no longer the interpreter those extraResources trees run on. `better-sqlite3` is rebuilt against that bundled ABI.

### Fixed

- Cursor worktree turns prefer a probed even LTS Node (≥20) over Homebrew Current. Odd majors dynamically linked against Cellar `libuv` were aborting in `uv_run` / `SpinEventLoopInternal`; those stacks are summarized with an install hint instead of hex frames.
- Failed worktree turns (runner crashes, CLI errors) are written into the agent transcript and returned on `wait_for_turn` / `get_turn_result` (`lastError` + `text`) so the orchestrator can switch agent or tell the user instead of seeing an empty reply.
- A dead Node/Cursor runner with no assistant output is respawned once (same path as a stale session id). Credits, auth, and missing packages are not retried.

## [0.1.99] - 2026-08-20

### Fixed

- Orchestrator-spawned worktree chats (Cursor MCP `send_to_thread` while the board is open) run on the desktop host so thinking/tools stream in the UI. MCP no longer drains those queues in the stdio child (blank chat, Stop/Send now no-ops). Stop and Send now SIGTERM a live `agentPid` even when this process does not own the turn. Cursor local streams that stall after the last frame end after 3 minutes of silence instead of hanging `wait_for_turn`.

## [0.1.98] - 2026-08-19

### Fixed

- Slack Listen opens a new Global coordinator after you close every chat (or delete the Slack one). The previous inbound still posted `Thread is archived` / skipped the reply instead of retrying.

## [0.1.97] - 2026-08-19

### Fixed

- The agent message token chip no longer sums cache reads/writes from every tool round (a Slack “hi” looked like ~175k). It shows last-request context occupancy, matching the ring; billed totals stay in the tooltip.

## [0.1.96] - 2026-08-19

### Fixed

- Slack Listen creates a new coordinator chat after you archive or delete the previous one, instead of going silent (no reaction, no thread). The inbound “seen” reaction is 👀 (`eyes`) rather than 👍.
- After commit-and-push, a clean draft PR no longer stays on **Commit & push**. Unpushed is counted against `origin/<this-branch>` (thread worktrees often still track `main`). The Draft pill keeps the PR number (`#113 ↗ Draft`) instead of clipping it away.
- The right-sidebar **Review** control stays pinned at typical pane widths. Files / Changes / Checks labels shorten first so Review is not pushed off-screen.

### Changed

- The create / worktree loading overlay is a window-move surface on the frameless Mac app, so you can drag Sideboard while worktree creation is in progress.

## [0.1.95] - 2026-08-19

### Changed

- Slack follow-up DMs and @mentions interrupt the in-progress coordinator turn and start a new request instead of replying that Sideboard is busy. Send `stop` to cancel without a replacement prompt.

## [0.1.94] - 2026-08-19

### Fixed

- Packaged Sideboard MCP (and Cursor runtime) no longer crash on `execa` with `SyntaxError: Named export 'getStreamAsArray' not found`. Staging had flattened `get-stream@5` (CJS, from extract-zip) over `get-stream@9` (ESM, what execa needs). Duplicate versions are nested under the dependent, and the isolated pack check imports execa.

## [0.1.93] - 2026-08-19

### Fixed

- Packaged Sideboard MCP actually starts under system `node`. 0.1.92 shipped `sideboard-mcp` with `better-sqlite3` but not `@modelcontextprotocol/sdk` / `execa` / `zod` / `@cursor/sdk`, so Claude, Cursor, Codex, and OpenCode all failed live tool discovery (`ERR_MODULE_NOT_FOUND`). Staging now copies core's production dependency tree (same pattern as `cursor-runtime`) and the isolated pack check boots `run-stdio.js`. Cursor SDK / `~/.cursor/mcp.json` entries set `type: "stdio"`.

## [0.1.92] - 2026-08-19

### Fixed

- Packaged Cursor orchestration no longer reports Sideboard MCP as down. 0.1.91 still launched MCP via Electron-as-Node from `app.asar`, so Cursor's local agent failed live tool discovery (only `mcp_auth` remained). MCP is now the CLI under a real `node` (`Contents/Resources/sideboard-mcp` extraResources + Node-ABI `better-sqlite3`). Packaged Sideboard merges that same command into `~/.cursor/mcp.json` so Cursor IDE sees the same store (`~/Library/Application Support/sideboard`).
- The right sidebar PR pill and Checks tab now show CI status (passing / pending / failing) without requiring you to open the Checks tab first.
- Creating a workspace from a branch that already has a GitHub PR now attaches that PR (`#111` pill) instead of leaving **Create PR**. Create-from-branch still uses a `thread/*` worktree; Sideboard looks up the source branch’s open PR and the sidebar retries that head if `prUrl` was never stored.

## [0.1.91] - 2026-08-19

### Fixed

- Packaged Cursor turns load their ESM runner inside Sideboard.app. 0.1.90 shipped `cursor-runtime` with `@cursor/sdk` but not `execa` / `smol-toml` / SDK deps, so Node failed with `ERR_MODULE_NOT_FOUND` (`#cachedDefaultResolve`).
- Agents no longer open the `ask_user` composer picker for greetings, check-ins, or invented “what next?” menus. The tool is only for when work is blocked on a concrete multiple-choice.

## [0.1.90] - 2026-08-19

### Fixed

- Packaged Cursor turns no longer start nested Chromium (`HasCustomHostObject`). 0.1.89 still ran the Cursor SDK runner as Electron-as-Node, so Cursor spawned `.js` with `process.execPath` (Sideboard.app) and stripped `ELECTRON_RUN_AS_NODE`. The runner now ships next to the asar (`extraResources` `cursor-runtime`) and runs under a real `node`.
- Agents no longer get `GH_TOKEN` in their environment (Cursor treats that as leaking secrets; Codex's sandbox strips `*TOKEN*` and then `git`/`gh` hit Keychain). Sideboard warms GitHub auth once at app start into `~/.sideboard-git-auth/` and points `git`/`gh` at that store. MCP reuses the files so remote-desktop Keychain prompts do not repeat every turn.
- Packaged Cursor turns no longer dump `findFilesWithRipgrep` asar stacks as `lastError`. The runner pins `CURSOR_RIPGREP_PATH` at extraResources `@cursor/sdk-<plat>/bin/rg` (macOS cannot exec binaries from `app.asar`). `[resource_exhausted]` is shown as a short usage/rate-limit note.
- Codex workspace-write turns can `git commit` in linked worktrees. The sandbox mounts `.git` read-only unless `writable_roots` names the gitdir; Sideboard now passes the worktree gitdir plus the main repo `.git` (where `index.lock` actually lives).

## [0.1.89] - 2026-08-19

### Fixed

- Agent streaming no longer paints one word at a time. Consecutive stdout/thinking frames are coalesced in spawn (Claude `content_block_delta`, Cursor, Codex, OpenCode, Brightsy), and the orchestrator no longer re-reads the thread JSON on every token.

## [0.1.88] - 2026-08-18

### Fixed

- Cursor MCP no longer wraps real `node` in `/bin/sh` that exports `ELECTRON_RUN_AS_NODE`. That made Cursor's local agent treat Sideboard MCP as nested Electron and crash at the first tool call (`HasCustomHostObject`). Packaged Electron-as-Node MCP uses a wrapper script whose `command` is the `.sh` path, not `Sideboard.app`.

## [0.1.87] - 2026-08-18

### Changed

- New worktrees run a repo setup script when one exists: `[scripts] setup` in `.sideboard` / `.conductor` settings, then `.cursor/worktrees.json`, then conventional `script/setup` / `bin/setup` / `scripts/setup(.sh)`. Setup runs in the background in parallel with the first agent turn.

## [0.1.86] - 2026-08-17

### Fixed

- Cursor local runs no longer pin `wait_for_turn` on a wedged SDK session. `send({ local: { force: true } })` expires leftover RUNNING state, create/resume disable stall auto-retry (which can drop tool completions), and SIGTERM cancels the live run before exit.

## [0.1.85] - 2026-08-17

### Fixed

- Cursor turns recover from unresumable local sessions (`Corrupt local agent checkpoint` / missing root blob / `Agent … not found`) by starting a fresh SDK agent instead of failing the turn. Crash dumps from Cursor's minified local agent and nested Electron (`HasCustomHostObject`) no longer become the thread `lastError`. Injected Cursor MCP no longer puts `ELECTRON_RUN_AS_NODE` in spawn env (the `/bin/sh` wrapper still sets it) so Cursor's Electron host cannot re-attach crashpad to Sideboard.app.
- Cursor / Slack git no longer prompts for the macOS Keychain. Agents and injected MCP get `GH_TOKEN` plus HTTPS rewrite, an empty credential helper, and batch-mode SSH so unattended turns fail closed instead of waiting on a GUI dialog.
- Codex workspace-write turns keep `GH_TOKEN` / `GIT_CONFIG_*` inside the sandbox (`shell_environment_policy`) and allow network so `git`/`gh` do not fall back to Keychain. Setup and run scripts get the same non-interactive git env.

## [0.1.83] - 2026-08-17

### Changed

- Worktree and orchestration agents can call MCP `ask_user` in any mode (not only Plan) when the user should pick from predefined options. The composer picker is the same UI as plan-mode questions. First-turn and per-turn prompts, plus the tool description, say to use it instead of plain chat bullets.

### Fixed

- Cursor turns (Grok and other Cursor models) no longer crash injected Sideboard MCP at startup (`HasCustomHostObject` / `ElectronInitializeICUandStartNode`). Cursor's local agent is itself Electron and was re-attaching crashpad env when spawning Electron-as-Node; MCP and the Cursor runner now unset `ELECTRON_*` / `CHROME_*` immediately before exec.
- Right sidebar PR pill and left-sidebar worktree hover show merge conflicts / behind-base against the default branch. A failed landing merge offers **Fix merge conflicts**, which asks the worktree agent to merge the remote base, resolve conflicts, then commit and push (Conductor’s phrasing).

## [0.1.82] - 2026-08-16

### Added

- Recurring process guides go in `.claude/skills/<name>/SKILL.md` so Claude Code and `attach` see them without Sideboard. Worktree and orchestrator prompts, plus the stock Review template, say not to write new skills under `.sideboard/skills`.
- `/graph-engineering` (`.claude/skills/graph-engineering/SKILL.md`, Cursor symlink) — judge-first, disk state, growing rulebook. `AGENTS.md` points at it.
- Marketing site and docs cover portable process skills (homepage compare table, `/docs/` repo config + guide card).

### Changed

- Orchestrators may tell a worktree agent to merge a GitHub PR (`ask_git` merge / “Merge PR.”) only when the user explicitly asked — not as a default “when ready” step.

### Fixed

- Agent turns and Cursor's local runner strip inherited `ELECTRON_*` / `CHROME_*` from the host Sideboard.app. Nested Electron (Claude Code, Cursor agent, MCP via Electron-as-Node) was crashing at startup (`HasCustomHostObject` / `ElectronInitializeICUandStartNode`). Run scripts already stripped these; spawn did not.
- Desktop renderer loads the stock Review template via a Vite alias instead of the `@sideboard-ai/core` barrel, so the Mac build no longer tries to bundle Node `fs`.

## [0.1.81] - 2026-08-16

Signed Mac desktop of 0.1.80.

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
