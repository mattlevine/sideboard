# `@sideboard-ai/cli`

Agent-agnostic worktree orchestration from the terminal.

```bash
npm i -g @sideboard-ai/cli

sideboard ls
sideboard send <thread> "…"
sideboard mcp          # MCP stdio server
```

Also installs `side` as a short alias. The MCP server is available as `sideboard mcp`, or via `@sideboard-ai/core`'s `sideboard-mcp` bin.

Slack inbound (official Sideboard app + hosted relay):

```bash
sideboard slack login          # browser OAuth
sideboard slack listen
```

How to connect and address Personal / Work Macs: [README — Slack](../../README.md#slack).
