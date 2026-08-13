# Slack

Sideboard’s built-in Slack path. Same steps as the [README](../README.md#slack).

## Connect

**Settings → Account → Slack workspaces**

1. **Add via browser** — install the official Sideboard Slack app (required for Listen; proves which Slack user owns this Mac).
2. **This Mac** — name the destination (`Personal`, `Work`, …). Personal and Work can both stay online.
3. Keep Sideboard running until status shows `Relay connected · …`.

Messages route to the Slack user who connected that Mac. Someone else needs their own Sideboard online.

## Destinations (Personal / Work)

| Where | What to type |
|-------|----------------|
| **DM the bot** | `work: Check the failing CI` |
| **Channel / thread** | `@sideboard work: Check the failing CI` |

Prefix matches the **This Mac** name (case-insensitive). Mentions are stripped before routing.

- One Mac online → it handles unprefixed messages.
- Both online → unprefixed races to the first claim. Replies are signed (`Work: …`) so you can see who answered, then address that Mac with `work:` / `personal:`.
- Send `stop` to interrupt an in-progress turn.

## CLI

```bash
sideboard slack teams
sideboard slack login
sideboard slack listen
```

Env override: `SIDEBOARD_SLACK_RELAY_URL` (e.g. local `ws://127.0.0.1:8787/desktop`).

Agents can also call MCP `list_teams` / `slack_list_channels` / `slack_list_users` / `slack_search` / `slack_read` / `slack_post` once a workspace is connected.

When `slack_post` notifies someone, a reply from that person (or anyone else in the thread) shows as a sidebar badge. Click it to open Slack. Those replies do not drive this Mac.

## Related

- Root [README — Slack](../README.md#slack)
- [Agent adapters](agent-adapters.md)
- [Compare](COMPARE.md)
