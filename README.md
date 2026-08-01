# Sideboard

**Your agent threads aren't trapped anywhere.**

Sideboard is an agent-agnostic orchestration layer over git worktrees. Run Claude Code, Codex, or OpenCode against isolated `thread/*` worktrees from the CLI, desktop app, or MCP — then `attach`, `adopt`, or land when you're ready.

## Why

- **Agent-agnostic** — one adapter interface for Claude Code, Codex, and OpenCode
- **Surface-agnostic** — CLI (`sideboard` / `side`), Electron app, MCP server, or native interactive via `attach`
- **Origin-agnostic** — `adopt` any worktree; import Conductor workspaces with full chat history (read-only)

Mechanical control (list, send, diff, land) belongs on the CLI — zero tokens. Use MCP when an agent needs *judgment* across threads.

## Install

### CLI (npm)

```bash
npm i -g @sideboard/cli
sideboard detect
```

### Homebrew (tap stub)

```bash
brew install sideboard-ai/tap/sideboard
```

See [`Formula/sideboard.rb`](Formula/sideboard.rb) for the formula stub used by the tap.

### Desktop

Download a signed DMG from [GitHub Releases](https://github.com/sideboard-ai/sideboard/releases). The app auto-updates via `electron-updater` (checks on launch and every 4 hours; prompts **Restart to update** — never restarts mid-session silently).

## Quick start

```bash
sideboard detect
sideboard new --from branch:main --agent claude
sideboard ls
sideboard send <thread> "add a README note"
sideboard diff <thread>
sideboard land <thread>          # interactive y/N; no --yes in v1
sideboard attach <thread>        # drop into the native CLI, same session
sideboard adopt --from-conductor # import Conductor workspaces + history
```

Aliases: `side` → `sideboard`.

## Monorepo

```
packages/core     # orchestrator, agents, git, MCP, store
packages/cli      # commander CLI (bins: sideboard, side)
apps/desktop      # Electron (electron-vite + React)
```

```bash
pnpm install
pnpm --filter @sideboard/core build
pnpm --filter @sideboard/cli build
pnpm --filter @sideboard/desktop dev
```

## MCP

```bash
sideboard mcp
```

Expose tools for list/create/send/diff/wait. `confirm_land` and purge stay human-only.

## Safety (v1)

- Landing on the default branch is blocked
- Dirty worktrees require an explicit land confirm (auto-commit then push/PR)
- Fork PRs are not landed in v1
- No `--yes` on `land`

## License

Apache-2.0
