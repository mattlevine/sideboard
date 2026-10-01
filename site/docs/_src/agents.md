# Agents

Sideboard shells out to each agent’s own CLI. Install the ones you want on your PATH and authenticate. Cursor uses a user-installed `@cursor/sdk` plus a `CURSOR_API_KEY` (Settings → Agents → Cursor → Install). Sideboard does not pack the Cursor SDK — so agents can update it without a new Sideboard build.

```bash
npm i -g @anthropic-ai/claude-code
npm i -g @openai/codex
npm i -g opencode-ai@latest
npm i -g @cursor/sdk
export CURSOR_API_KEY="cursor_..."
```

Then `sideboard detect` (or Settings → Agents) shows which harnesses are installed and signed in.

| Agent | How it runs |
|-------|-------------|
| Claude Code | Official CLI on PATH |
| Codex | Official CLI on PATH |
| OpenCode | Official CLI on PATH |
| Cursor | User-installed `@cursor/sdk` + API key |
| Brightsy | Optional chat-only adapter |

Mechanical control (list, send, diff, land) stays on the Sideboard CLI — zero tokens. Use MCP when an agent needs judgment across threads or needs to open a pane in the desktop.

Connect the Sideboard MCP from each harness so an agent can drive the board. Typical stdio command: `sideboard mcp` (or `npx -y sideboard-mcp`). Packaged Sideboard.app writes the absolute Node + bundled MCP path on launch.

See [Remote integrations](/docs/remote/) for Settings → Agents vs Git / Issues / Slack / Connectors.
