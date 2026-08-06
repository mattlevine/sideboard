# Remote integrations (Slack, Discord, …)

Sideboard’s **CLI** and **MCP server** are first-class control surfaces. They do not require the desktop app or Brightsy.

That means you can build your own remote chat bridge: Slack bot, Discord bot, HTTP webhook, cron, etc. Brightsy’s Slack/Discord/Teams path (desktop cloud-connect daemon) is one optional consumer of the same control plane.

## Architecture

```
Your bot / webhook / script
        │
        ├─► sideboard CLI   (zero tokens: list, send, diff, land)
        │
        └─► sideboard MCP   (agents need judgment across threads)
                │
                ▼
         worktree threads (Claude / Codex / OpenCode / Cursor / …)
```

Local orchestration without any remote product:

```bash
sideboard mcp          # stdio MCP for any MCP client
# or from desktop: Orchestration → New chat (no Brightsy hop)
```

## Preferred building blocks

### CLI (mechanical, zero tokens)

Use for scripts and bots that already know what to do:

```bash
sideboard ls
sideboard new --from branch:main --agent claude
sideboard send <thread> "fix the failing test"
sideboard diff <thread>
sideboard land <thread>          # human confirm — keep land/purge human-gated
```

For turn completion from automation, prefer MCP `wait_for_turn` (or poll `sideboard ls`) rather than assuming a CLI `wait` command.

Land and purge stay human-only by design. Remote bots should open draft PRs or ping a human rather than auto-landing to the default branch.

### MCP (judgment across the fleet)

Point any MCP-capable agent at `sideboard mcp`. Useful tools include:

- `list_workspaces` / `list_threads`
- `create_thread` / `send_to_thread` / `wait_for_turn` / `get_turn_result`
- `get_diff` / `preview_land` / `create_draft_pr`

Do **not** expose human-only land/purge as automated bot actions.

## Example patterns

1. **Slack → script** — Slash command runs `sideboard new` + `send`, posts thread id + deep link back to Slack.
2. **Slack → MCP agent** — A coordinator agent with Sideboard MCP tools plans fan-out, waits on turns, summarizes diffs.
3. **CI / cron** — Nightly `sideboard` jobs for backlog tickets; results as draft PRs.

## Brightsy (optional)

If you already use Brightsy, the built-in remote orchestrator can drive the same MCP fleet via Slack/Discord/Teams. Setup is documented in the root README under **Optional: Brightsy**. You do not need Brightsy to ship a Slack integration.

## Safety

- Keep `land` / purge behind a human.
- Treat inbound chat as untrusted input; don’t pipe raw messages into `--yes` land flows (v1 has no `--yes` on land).
- Prefer draft PRs (`create_draft_pr` / `gh pr create --draft`) from automation.
