# Sideboard vs peers

Short positioning for contributors and evaluators. Not a feature-complete matrix.

## vs Conductor (Melty — closed)

| | Conductor | Sideboard |
|-|-----------|-----------|
| Model | Polished Mac app around worktree workspaces | Open control plane: CLI + MCP + desktop |
| Lock-in | Sessions live in the app | `attach` / `adopt` — move in and out of native CLIs |
| Agent visibility | Human-oriented board | Board **plus** MCP so an agent can reason about other threads |
| Remote chat | Product-specific | CLI/MCP are separate — build your own Slack bridge, or use optional Brightsy |

Use Conductor when you want a finished Mac workspace UI and are fine staying inside it. Use Sideboard when you want scriptable/MCP fleet control and handoff.

## vs “open Conductor” clones

Several OSS projects aim to recreate Conductor’s local board (worktrees + terminals + diffs). Sideboard’s wedge is different:

1. **Handoff** — attach/adopt/Conductor import, not a closed session cage
2. **Agent-visible fleet** — MCP for cross-thread judgment
3. **Surface split** — CLI (zero tokens) vs MCP (judgment) vs desktop (board)

If you only need a TUI/dashboard over `claude`/`codex` worktrees, a thinner clone may be enough. If you need orchestration that other agents can drive, start here.

## vs YAML workflow runners (e.g. Microsoft Conductor)

Those tools version **deterministic multi-agent pipelines** in YAML. Sideboard orchestrates **live coding sessions** in git worktrees. Related category name; different job.
