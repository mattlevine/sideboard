# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
