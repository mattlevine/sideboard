# Contributing to Sideboard

Thanks for contributing. Sideboard is a monorepo: core orchestration, CLI, and desktop UI.

## Surfaces (pick one)

| Surface | Package / app | Job |
|---------|---------------|-----|
| Core | `packages/core` | Agents, git worktrees, store, MCP server |
| CLI | `packages/cli` | Zero-token control (`sideboard` / `side`) |
| Desktop | `apps/desktop` | Global board UI (Electron) |

CLI and MCP run **independently** of the desktop app. Prefer fixing core + CLI first; desktop can follow.

## Setup

```bash
pnpm install
pnpm --filter @sideboard/core build
pnpm --filter @sideboard/cli build
```

Optional desktop:

```bash
pnpm --filter @sideboard/desktop dev
```

Node ≥ 20. Package manager: pnpm 9 (see root `packageManager`).

## Checks

```bash
pnpm --filter @sideboard/core build
pnpm --filter @sideboard/cli build
pnpm --filter @sideboard/core test
pnpm --filter @sideboard/cli test
```

`pnpm typecheck` currently reports known debt in Thread test fixtures and electron-vite config typings; CI runs typecheck as a soft step. Prefer green **build + test** before opening a PR.

Optional desktop:

```bash
pnpm --filter @sideboard/desktop typecheck
```

## Where to contribute

- **New coding agent** — see [docs/agent-adapters.md](docs/agent-adapters.md)
- **Remote chat bridges (Slack, etc.)** — use CLI/MCP; see [docs/remote-integrations.md](docs/remote-integrations.md). Brightsy’s cloud path is one optional consumer, not required.
- **MCP tools** — `packages/core/src/mcp/`
- **CLI commands** — `packages/cli/src/`
- **Board UI** — `apps/desktop/src/renderer/`

## Safety invariants (don’t break)

- `confirm_land` / purge stay **human-only** (not exposed as MCP write-confirm tools)
- Landing on the default branch stays blocked
- No `--yes` on `land` in v1

## Pull requests

1. Keep PRs focused (one adapter, one command, one UI fix).
2. Include tests when changing adapters, MCP, or git land paths.
3. Run build + tests before opening the PR (`pnpm --filter @sideboard/core test`, etc.).
4. Update docs/README when behavior or public CLI/MCP surface changes.

## License

By contributing, you agree your contributions are licensed under the Apache-2.0 License (see [LICENSE](LICENSE)).
