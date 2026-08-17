# Architecture

pnpm 9 workspace (`packages/*`, `apps/*`). Node ≥ 20. Public packages share one version (today `0.1.x`).

| Path | Package | Role |
|------|---------|------|
| `packages/core` | `@sideboard-ai/core` | Orchestration, worktrees, store, MCP, Slack, git |
| `packages/cli` | `@sideboard-ai/cli` | `sideboard` / `side` CLI (`sideboard mcp` / `sideboard-mcp`) |
| `apps/desktop` | `@sideboard-ai/desktop` | Electron board (depends on core via `workspace:*`). **Apple Silicon (arm64) only** — electron-builder dmg+zip; no Intel/x64. |
| `apps/slack-relay` | `@sideboard-ai/slack-relay` | Hosted Fly relay (Socket Mode + OAuth + static `site/`) |

CLI and MCP run **without** the desktop. Prefer fixing core + CLI first.

## Data flow (short)

- **Worktree threads** — one agent per git worktree (`thread/*`). Desktop / CLI / MCP create and drive them.
- **Orchestration (Global)** — coordinator agent uses Sideboard MCP (`list_threads`, `create_thread`, `send_to_thread`, `ask_git`, …). It does not live inside a project worktree. Fleet playbook is one document written as both `AGENTS.md` and `CLAUDE.md` in the synthetic home (Claude vs Codex/Cursor filenames). First-turn prompt adds audience, goal, and workspace inventory only — not a third copy of the playbook. Token totals are Claude-shaped (`inputTokens` uncached; cache extra). Codex and Brightsy report OpenAI-shaped usage (`cached_*` already inside input; Codex `reasoning_output_tokens` already inside output) — adapters subtract before the UI. Claude, Cursor SDK, and OpenCode already report additive cache.
- **Slack** — hosted relay `wss://relay.sideboard.cloud/slack/desktop`. OAuth callback `https://relay.sideboard.cloud/slack/callback` (client secret stays on Fly). Desktop Listen registers this Mac; DMs/@mentions go to the Global orchestrator. Compute stays on the Mac (VPN); the relay routes Slack chat only. The machine must stay awake. The same Fly app serves the marketing site at `https://www.sideboard.cloud/` (`site/`).

## Where to change what

| Change | Start here |
|--------|------------|
| Agent adapter | `packages/core/src/agents/` — see [../agent-adapters.md](../agent-adapters.md) |
| MCP tools | `packages/core/src/mcp/` |
| CLI commands | `packages/cli/src/` |
| Board UI | `apps/desktop/src/renderer/` |
| Electron main / IPC | `apps/desktop/src/main/` |
| Slack listen / relay / OAuth | `packages/core/src/slack/`, `apps/slack-relay/` |
| Slack Marketplace / Public Distribution | [slack-marketplace.md](slack-marketplace.md) |
| Marketing site | `site/` — same Fly app as the relay; [deploy.md](deploy.md) |
| Git worktrees / land | `packages/core/src/git/`, `packages/core/src/land/` |
| Process skills | `packages/core/src/skills/` (discovery), `.claude/skills/` (committed guides) |

Desktop `predev` builds core. After core changes, rebuild core (or restart `pnpm dev`) before expecting the app to pick them up. The renderer may `import type` from `@sideboard-ai/core` but must not import values from the core barrel (that pulls Node `fs` into Vite). Value helpers go through `@sideboard/*` aliases in `apps/desktop/electron.vite.config.ts`.

**Nested Electron.** Sideboard.app leaks `ELECTRON_*` / `CHROME_*` (crashpad/GPU) into children. A nested Electron then dies at startup (`HasCustomHostObject` / `ElectronInitializeICUandStartNode`). Agent spawn and run scripts strip those keys. That is not enough when the immediate parent is also Electron — Cursor's local agent (Grok and other Cursor models) merges MCP env onto its own crashpad pipe, and the crash happens in `ElectronInitializeICUandStartNode` before JS can unset env. Electron-as-Node MCP and the Cursor runner are launched through `/bin/sh` that unsets `ELECTRON_*`/`CHROME_*` and re-exports `ELECTRON_RUN_AS_NODE` before exec. Helpers live in `packages/core/src/hook/nested-electron-env.ts`.

## Process skills

Recurring process guides are **Claude Code project skills** at `.claude/skills/<name>/SKILL.md` (committed). Sideboard discovers that folder (and `.cursor/skills`, legacy `.sideboard/skills`, …) for composer `/name` expand. Native Claude Code and `attach` load `.claude/skills` without Sideboard. New skills must not be written only under `.sideboard/skills`. The worktree playbook (`formatProcessGuideDirective`) and orchestrator playbook state this; the stock Review template asks reviewers to propose a sentence for `review.md` or a skill when a missing rule will recur.

This repo ships [`.claude/skills/graph-engineering/SKILL.md`](../../.claude/skills/graph-engineering/SKILL.md) (`/graph-engineering`) — the method for fan-out / batch work. `.cursor/skills/graph-engineering` is a symlink so Cursor sees the same file. `AGENTS.md` / `CLAUDE.md` point at it for Codex and OpenCode.
