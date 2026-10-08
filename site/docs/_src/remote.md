# Remote integrations

Desktop Settings splits connections by job. The phone app is remote control. Linear and AbleTime are issue tracking. Vercel, Supabase, PostHog, and Sentry are optional project services. GitHub git auth is its own panel.

| Panel | What |
|-------|------|
| **Settings → Agents** | Default agent / model / effort, default orchestrator agent / model / effort, then harness setup |
| **Settings → Git** | `gh` / SSH / PAT for this Mac and worktree agents |
| **Settings → Issues** | Issue source, Linear, AbleTime |
| **Settings → Remote** | Relay account (GitHub, the git host), this Mac’s name, phone pairing code |
| **Settings → Connectors** | Vercel, Supabase, PostHog, Sentry tokens; **Install CLI** when `vercel` / `supabase` / `sentry-cli` is missing |

Connections are owned by Sideboard, not per-agent MCP. Optional connector tokens inject env into worktree agents; prefer official CLIs (`vercel`, `supabase`, `sentry-cli`) or the PostHog HTTP API. Write CLI/HTTP dumps to `.context/cli/` (not `.context/attachments/`) and read a slice. Do not add vendor MCPs.

## Phone

The phone app is remote control for the **local** orchestrator. Agents, worktrees, and repos stay on this Mac. Message text goes through `relay.sideboard.cloud` at `/remote`. The Mac must stay awake — enable **Settings → Advanced → Caffeinate while the phone remote is connected**, or `set_caffeinate` from the orchestration chat.

**Settings → Remote** signs this Mac in with its git host (GitHub today), then shows **Show pairing code**. Settings → Git is where this Mac’s `gh`, SSH, or PAT credentials live. Enter the code in the Sideboard phone app. The phone lists every Mac it has paired, using the name from Settings → Remote, and you choose which desktop to open. Replies stream while the agent writes, with the desktop’s markdown, code colors, and diagrams. Tapping a file path opens that file on the Mac. Send `stop` to cancel a turn. `ask_user` options show up as buttons.

Product questions: [Support](/support/).

See [Agents](/docs/agents/) and [Compare](/docs/compare/).
