# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
