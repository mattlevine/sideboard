# `@sideboard-ai/cli`

Agent-agnostic worktree orchestration from the terminal.

```bash
npm i -g @sideboard-ai/cli

sideboard ls
sideboard send <thread> "…"
sideboard mcp          # MCP stdio server
sideboard schedule ls  # local jobs that trigger a chat
```

Also installs `side` as a short alias. The MCP server is available as `sideboard mcp`, or via `@sideboard-ai/core`'s `sideboard-mcp` bin.

The phone app is the remote. Pair it from Settings → Remote on the Mac, then pick that desktop in the app. Agents stay on the Mac. Details: [README — Phone](../../README.md#phone).

Schedules (Settings, CLI, or MCP `create_schedule`) fire only while Sideboard.app is running. Overnight: Settings → Advanced → Caffeinate while schedules are enabled. Details: [README — Scheduled orchestration](../../README.md#scheduled-orchestration).
