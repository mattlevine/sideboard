# `@sideboard-ai/cli`

Agent-agnostic worktree orchestration from the terminal.

```bash
npm i -g @sideboard-ai/cli

sideboard ls
sideboard send <thread> "…"
sideboard mcp          # MCP stdio server
sideboard schedule ls  # local jobs that trigger orchestration chats
```

Also installs `side` as a short alias. The MCP server is available as `sideboard mcp`, or via `@sideboard-ai/core`'s `sideboard-mcp` bin.

Slack inbound (official Sideboard app + hosted relay):

```bash
sideboard slack login          # browser OAuth
sideboard slack listen
```

How to connect and address Personal / Work Macs: [README — Slack](../../README.md#slack).

Schedules (Settings, CLI, or MCP `create_schedule`) fire only while Sideboard.app is running. Overnight: Settings → Advanced → Caffeinate while schedules are enabled. Details: [README — Scheduled orchestration](../../README.md#scheduled-orchestration).
