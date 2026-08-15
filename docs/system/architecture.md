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
- **Orchestration (Global)** — coordinator agent uses Sideboard MCP (`list_threads`, `create_thread`, `send_to_thread`, `ask_git`, …). It does not live inside a project worktree.
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

Desktop `predev` builds core. After core changes, rebuild core (or restart `pnpm dev`) before expecting the app to pick them up.
