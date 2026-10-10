# Remote integrations

Desktop Settings splits connections by job. The phone app is remote control. Linear and AbleTime are issue tracking. Vercel, Supabase, PostHog, and Sentry are optional project services. GitHub git auth is its own panel.

| Panel | What |
|-------|------|
| **Settings → Agents** | Default agent / model / effort, default orchestrator agent / model / effort, then harness setup |
| **Settings → Git** | `gh` / SSH / PAT for this Mac and worktree agents |
| **Settings → Issues** | Issue source, Linear, AbleTime |
| **Settings → Remote** | This Mac’s name, phone pairing code, relay status |
| **Settings → Connectors** | Vercel, Supabase, PostHog, Sentry tokens; **Install CLI** when `vercel` / `supabase` / `sentry-cli` is missing |

Connections are owned by Sideboard, not per-agent MCP. Vercel, Supabase, and Sentry tokens inject env into worktree agents; prefer official CLIs (`vercel`, `supabase`, `sentry-cli`). PostHog is the `posthog_api` tool (the key is not copied onto the agent). Write CLI dumps to `.context/cli/` (not `.context/attachments/`) and read a slice. Do not add vendor MCPs.

Same phone steps as the [README](../README.md#phone). Linear / AbleTime: [README — Linear](../README.md#linear) and [AbleTime](../README.md#abletime). Connectors: [README — Connectors](../README.md#connectors).

## Phone

The phone app is remote control for the **local** orchestrator. Agents, worktrees, and repos stay on this Mac. Message text goes through `relay.sideboard.cloud` at `/remote`. The relay does not host worktrees. The Mac must stay awake. Enable **Settings → Advanced → Caffeinate while the phone remote is connected**, or `set_caffeinate` from the orchestration chat.

**Settings → Remote** shows Relay connected, this Mac’s name, and **Show pairing code**. Start `apps/mobile` from the Run menu (**Mobile**) or with `pnpm --filter @sideboard-ai/mobile start`, then enter that code. The phone keeps every Mac it has paired and you choose which desktop to open. Send `stop` to cancel a turn. `ask_user` options render as buttons on the phone.

Env override: `SIDEBOARD_REMOTE_RELAY_URL` (default `wss://relay.sideboard.cloud/remote`).

## Related

- Root [README — Settings](../README.md#settings)
- Root [README — Phone](../README.md#phone)
- [Agent adapters](agent-adapters.md)
- [Compare](COMPARE.md)
