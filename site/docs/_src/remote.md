# Remote integrations

Desktop Settings splits connections by job. The phone app is remote control. Linear, AbleTime, and GitHub Issues are issue tracking. Cursor Origin and Entire are git hosts, not GitHub issue sources. Entire’s tickets are Trails. Vercel, Supabase, PostHog, and Sentry are optional project services. Git hosts (GitHub, Cursor, and Entire) are their own panels under Settings → Git, the same way each agent has its own options.

| Panel | What |
|-------|------|
| **Settings → Agents** | Default agent / model / effort, default orchestrator agent / model / effort, then harness setup |
| **Settings → Git** | GitHub (`gh` / SSH / PAT), Cursor (`origin` login), and Entire (`entire login`) for this Mac and worktree agents |
| **Settings → Issues** | Issue source, Linear, AbleTime |
| **Settings → Remote** | This Mac’s name, phone relay, phone sign-in, pairing code. Slack uses the Mac name. Slack sign-in and Listen stay on Sideboard’s Slack relay. |
| **Settings → Collaboration** | Slack. Add via browser once per team so agents can post as @Sideboard and read the reply. |
| **Settings → Connectors** | Vercel, Supabase, PostHog, Sentry tokens; **Install CLI** when `vercel` / `supabase` / `sentry-cli` is missing |

Connections are owned by Sideboard, not per-agent MCP. Vercel, Supabase, and Sentry tokens inject env into worktree agents; prefer official CLIs (`vercel`, `supabase`, `sentry-cli`). PostHog is the `posthog_api` tool (the key is not copied onto the agent). Write CLI dumps to `.context/cli/` (not `.context/attachments/`) and read a slice. Do not add vendor MCPs.

## Phone

The phone app is remote control for the **local** orchestrator. Agents, worktrees, and repos stay on this Mac. Message text is encrypted between the phone and this Mac; the relay at `/remote` forwards ciphertext. The default is `relay.sideboard.build`. To run your own, see [Run your own relay](/docs/relay/) — that service is the relay only, not this website. A connected phone keeps the Mac awake (`caffeinate -dimsu`; the lid can close on power, and may still sleep on battery). **Settings → Advanced → Caffeinate while the phone remote is armed** also holds that wake while the remote is running and no phone has joined. `set_caffeinate` from the orchestration chat is a separate hold. Quit the window and leave `sideboard serve` running to keep the relay (it exits if the app is already the host). `sideboard serve --lan` prints `ws://<lan-ip>:<port>/remote` for the phone’s Relay field. A blocked chat shows **Needs you** and the reason.

**Settings → Remote** signs this Mac in with GitHub, Cursor, or Entire, then shows a pairing QR code. Each registered project keeps its own origin, so the repos on this Mac do not have to share a git host. Settings → Git → GitHub is where this Mac’s `gh`, SSH, or PAT credentials live. Settings → Git → Cursor is the Origin CLI login for Cursor repos. Settings → Git → Entire is the Entire CLI login; those repos use Trails instead of pull requests. Scan that code in the Sideboard phone app. Paste the line under the code if you can’t scan. The phone lists every Mac it has paired, using the name from Settings → Remote, and you choose which desktop to open. Replies stream while the agent writes, with the desktop’s markdown, code colors, and diagrams. The open workspace has Chat, All files, Changes, Checks, and Review. Opening a file from Changes shows the same unified diff as the desktop. Files you open stay on a row underneath. All files filters the worktree, and selecting text in a file adds that range to the chat. Tapping a file path or an artifact opens it on the phone. Send `stop` to cancel a turn. `ask_user` options show up as buttons.

## Slack

Slack is collaboration, not remote control. From **Settings → Collaboration → Add via browser**, install the Sideboard app into one workspace. Click it again for another team. That install is how the team signs in. Slack issues the bot token during the install. To reconnect a team, disconnect it and add it via browser again. Agents post as **@Sideboard** (a PR to review, for example) and read the reply. Name this Mac on Settings → Remote. The relay address there is for the phone. Slack sign-in and Listen stay on Sideboard’s Slack relay. See [Slack](/slack/).

Product questions: [Support](/support/), or the community Slack at [sideboard-ai.slack.com](https://sideboard-ai.slack.com).

See [Agents](/docs/agents/).
