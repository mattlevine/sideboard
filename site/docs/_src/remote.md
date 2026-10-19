# Remote integrations

Desktop Settings splits connections by job. The phone app is remote control. Linear and AbleTime are issue tracking. Vercel, Supabase, PostHog, and Sentry are optional project services. GitHub git auth is its own panel.

| Panel | What |
|-------|------|
| **Settings → Agents** | Default agent / model / effort, default orchestrator agent / model / effort, then harness setup |
| **Settings → Git** | `gh` / SSH / PAT for this Mac and worktree agents |
| **Settings → Issues** | Issue source, Linear, AbleTime |
| **Settings → Remote** | Relay address, relay account (GitHub, the git host), this Mac’s name, phone pairing code |
| **Settings → Connectors** | Vercel, Supabase, PostHog, Sentry tokens; **Install CLI** when `vercel` / `supabase` / `sentry-cli` is missing |

Connections are owned by Sideboard, not per-agent MCP. Vercel, Supabase, and Sentry tokens inject env into worktree agents; prefer official CLIs (`vercel`, `supabase`, `sentry-cli`). PostHog is the `posthog_api` tool (the key is not copied onto the agent). Write CLI dumps to `.context/cli/` (not `.context/attachments/`) and read a slice. Do not add vendor MCPs.

## Phone

The phone app is remote control for the **local** orchestrator. Agents, worktrees, and repos stay on this Mac. Message text is encrypted between the phone and this Mac; the relay at `/remote` forwards ciphertext. The default is `relay.sideboard.cloud`. To run your own, see [Run your own relay](/docs/relay/) — that service is the relay only, not this website. The Mac must stay awake — enable **Settings → Advanced → Caffeinate while the phone remote is connected**, or `set_caffeinate` from the orchestration chat. Quit the window and leave `sideboard serve` running to keep the relay (it exits if the app is already the host). `sideboard serve --lan` prints `ws://<lan-ip>:<port>/remote` for the phone’s Relay field. A blocked chat shows **Needs you** and the reason.

**Settings → Remote** signs this Mac in with its git host (GitHub today), then shows a pairing QR code. Settings → Git is where this Mac’s `gh`, SSH, or PAT credentials live. Scan that code in the Sideboard phone app. Paste the line under the code if you can’t scan. The phone lists every Mac it has paired, using the name from Settings → Remote, and you choose which desktop to open. Replies stream while the agent writes, with the desktop’s markdown, code colors, and diagrams. The open workspace has Chat, All files, Changes, Checks, and Review. Opening a file from Changes shows the same unified diff as the desktop. Files you open stay on a row underneath. All files filters the worktree, and selecting text in a file adds that range to the chat. Tapping a file path or an artifact opens it on the phone. Send `stop` to cancel a turn. `ask_user` options show up as buttons.

Product questions: [Support](/support/).

See [Agents](/docs/agents/) and [Compare](/docs/compare/).
