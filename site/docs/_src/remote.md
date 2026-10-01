# Remote integrations

Desktop Settings splits connections by job. Slack is remote control. Linear and AbleTime are issue tracking. Vercel, Supabase, PostHog, and Sentry are optional project services. GitHub git auth is its own panel.

| Panel | What |
|-------|------|
| **Settings → Agents** | Default agent / model / effort, default orchestrator agent / model / effort, then harness setup |
| **Settings → Git** | `gh` / SSH / PAT for this Mac and worktree agents |
| **Settings → Issues** | Issue source, Linear, AbleTime |
| **Settings → Remote** | Slack workspaces, this Mac’s name, Listen / Relay |
| **Settings → Connectors** | Vercel, Supabase, PostHog, Sentry tokens; **Install CLI** when `vercel` / `supabase` / `sentry-cli` is missing |

Connections are owned by Sideboard, not per-agent MCP. Optional connector tokens inject env into worktree agents; prefer official CLIs (`vercel`, `supabase`, `sentry-cli`) or the PostHog HTTP API. Write CLI/HTTP dumps to `.context/cli/` (not `.context/attachments/`) and read a slice. Do not add vendor MCPs.

## Slack

Slack is remote control for the **local** orchestrator. Agents, worktrees, and repos stay on this Mac (corporate VPN, private git, internal APIs). Message text goes through `relay.sideboard.cloud`; the relay does not host worktrees. The Mac must stay awake — Slack cannot reach a sleeping machine. For unattended Listen, enable **Settings → Advanced → Caffeinate while Slack Listen is on**, or `set_caffeinate` from the orchestration chat.

Full Slack landing and Add to Slack: [sideboard.cloud/slack](/slack/). Product questions: join the Sideboard community at [sideboard-ai.slack.com](https://sideboard-ai.slack.com) — that is a public workspace, not a substitute for **Add via browser** on your own team. Join steps: [Support](/support/).

### Connect

**Settings → Remote → Slack**

1. **Add via browser** — install the official Sideboard Slack app (required for Listen; proves which Slack user owns this Mac). OAuth redirect: `https://relay.sideboard.cloud/slack/callback` (the relay exchanges the code; the Mac never holds the client secret).
2. **This Mac** — name the destination (`Personal`, `Work`, …). Personal and Work can both stay online.
3. Keep Sideboard running until status shows `Relay connected · …`. Use **Cancel** in Settings if you close the Slack tab.

Messages route to the Slack user who connected that Mac. Someone else needs their own Sideboard online.

### Destinations (Personal / Work)

| Where | What to type |
|-------|----------------|
| **DM the bot** | `work: Check the failing CI` |
| **Channel / thread** | `@sideboard work: Check the failing CI` |

Prefix matches the **This Mac** name (case-insensitive). Mentions are stripped before routing.

- One Mac online → it handles unprefixed messages.
- Both online → unprefixed races to the first claim. Replies are signed (`Work: …`) so you can see who answered, then address that Mac with `work:` / `personal:`.
- A follow-up message interrupts the in-progress turn and starts a new one. Send `stop` to cancel without a replacement prompt.
- Closing the Slack coordinator chat (or every Global tab) does not disable Listen. The next DM/@mention opens a new Global chat and replies there.

If a DM never gets 👀 and no new Global chat appears, Listen is not registered with the relay. Quit and reopen Sideboard so it reconnects. Settings → Remote → Slack should show `Relay connected`.

### CLI

```bash
sideboard slack teams
sideboard slack login
sideboard slack listen
```

Agents can also call MCP `list_teams` / `slack_list_channels` / `slack_list_users` / `slack_search` / `slack_read` / `slack_post` / `slack_replies` once a workspace is connected.

When `slack_post` notifies someone, their reply is relayed into the orchestration chat as information (not a command).

See [Agents](/docs/agents/) and [Compare](/docs/compare/).
