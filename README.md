# Sideboard

**Local orchestration for a fleet of coding agents.** On your Mac, on the network you already sit on.

One agent per git worktree is a crowded pattern in 2026 — Conductor, Cursor’s Agents window, Claude Code, and OSS boards (Superset, Emdash, Claude Squad) all spawn that. The remaining job is an **orchestration tier**: an agent that can reason about other threads, a board where you can see that, and Slack so a coworker can enter the loop — without moving the repo into someone else’s cloud.

Sideboard is CLI + MCP + a Mac desktop for that tier. Agents are plugs (Claude Code, Codex, OpenCode, Cursor). Compute stays on this machine (corporate VPN, private git, internal APIs). Slack is remote control, not a rented sandbox.

1. **A global board for you** — status, live output, and fan-out across every thread
2. **An MCP for the agents** — list threads, wait on turns, read diffs, orchestrate the fleet, and present artifacts, schemas, and files in the desktop UI
3. **Slack to this Mac** — DM/@mention the orchestrator; it can ping a coworker to review a PR a worktree just pushed; their reply comes back as information

`attach` / `adopt` remain the door back to the native harness — move in and out of Sideboard as you choose.

Run agents in isolated `thread/*` worktrees from the CLI, desktop, or MCP. The Mac must stay awake for Slack to reach them, and for scheduled jobs to fire — opt in from Settings → Advanced.

![Sideboard desktop — chat with Document artifact preview, worktree files, and the run panel](docs/assets/sideboard-desktop-review-v5.png)

**Agents and backends are plugs, not the product.** CLI, MCP, and the desktop board work with Claude Code, Codex, OpenCode, and Cursor alone. Schema UI is **JSON Schema → table/form**, not a CMS shell. The agent can invent a schema for whatever data it needs; wire inline JSON or another datasource later. CLI and MCP also run without the desktop app. Slack is built in ([setup](#slack)).

## Who it's for

Fits if you already run several local CLI agents on a Mac — especially one on a corporate VPN — and want an orchestrator you can see, an agent can drive, and Slack can reach. Extra fit when the agent produces structured content or HTML that should sit next to the diff.

Use something else if you want a polished local board and will not use CLI/MCP ([Conductor](https://www.conductor.build/) free), their paid cloud workspaces (agents that keep running after you close the laptop, off-VPN), an IDE-native Agents window (Cursor 3), Windows/Linux desktop ([Emdash](https://emdash.sh/), [Superset](https://github.com/superset-sh/superset)), or cloud agents that do not run on this machine.

Peer-by-peer notes: [Compare](docs/COMPARE.md).

## Why it exists

Spawning worktrees is the shared primitive. Boards that stay human-only tend to put fleet orchestration in a **paid cloud**. Sideboard puts that tier on the Mac you already use, on the VPN it is already on:

| Job | Typical tools | Sideboard |
|-----|---------------|-----------|
| Run N agents in isolated worktrees | Yes | Yes |
| Orchestrate the fleet (agent-visible) | Human board, or a cloud API | MCP + Global board, on this Mac |
| Stay on the corporate VPN | Cloud sandboxes leave it | Agents run as you, on this laptop’s network |
| Coworker in the loop | Product cloud / shared sandbox | Slack: review ping; reply comes back as info |
| Keep going when you step away | Cloud sandbox keeps running | Slack to this Mac — the machine must stay awake (opt-in caffeinate) |
| Run work on a schedule | Cloud cron / always-on sandbox | Local jobs on this Mac; opt-in caffeinate so due jobs can fire |
| See the whole fleet as one board | App-locked or thin | First-class global board |
| Drop into the native CLI mid-session | Weak or one-way | `attach` keeps the same session |
| Recurring process guides | Locked in the product, or chat memory | Committed `.claude/skills` — Claude Code and `attach` load them |
| Bring existing worktrees / Conductor workspaces in | Stuck or start over | `adopt` + Conductor import |
| Review HTML / docs the agent built | Copy out, or locked chat UI | `present_artifact` → side column |
| Collect / edit structured data the agent needs | Spreadsheet, separate CMS, or markdown forever | `present_schema` → form/table from a schema the agent can create |
| Files for that data + the git worktree | Two other windows | File manager tabs + far-right repo Files / Changes / CI |

Agents write code **and** invent data shapes (content, configs, feedback, ops rows). Sideboard is where those meet — **code in the worktree, data in schema UI** — without a CMS product.

A concrete loop: pull or edit page content and media in schema + files tabs, then have the agent write it into a **static site** in the same worktree (Astro, Next export, Eleventy, plain HTML) — review the data and the generated pages before you land.

Mechanical control (list, send, diff, land) stays on the CLI — zero tokens. Use MCP when an agent needs *judgment* across threads or needs to open a pane. CLI `land` and `purge` stay human-only. Orchestrators may tell a worktree agent to merge (`ask_git`) only when the user explicitly asked.

Also true, and useful on the way:

- **Agent-agnostic** — Claude Code, Codex, OpenCode, Cursor (via `@cursor/sdk`, Conductor-style)
- **Schema-agnostic / CMS-optional** — render any JSON Schema + `schemaUi`. CMS is a use case, not the category
- **Surface-agnostic** — CLI (`sideboard` / `side`), Electron desktop, MCP, or native interactive via `attach`
- **Origin-agnostic** — create from branch/PR/ticket, adopt any worktree, import Conductor workspaces with chat history
- **Local-first / Slack-remote** — agents stay on this Mac (VPN, private git, internal APIs); Slack is how you and a coworker reach them ([setup](#slack))
- **Portable process skills** — recurring guides are Claude Code project skills (`.claude/skills/<name>/SKILL.md`). Sideboard `/name`, Claude Code, and `attach` all load that path ([Process skills](#process-skills))

Docs: [Contributing](CONTRIBUTING.md) · [Agent adapters](docs/agent-adapters.md) · [Settings](#settings) · [Slack](#slack) · [Scheduled orchestration](#scheduled-orchestration) · [Remote integrations](docs/remote-integrations.md) · [Compare](docs/COMPARE.md) · [Process skills](#process-skills) · [Security](SECURITY.md)

Marketing site: [www.sideboard.cloud](https://www.sideboard.cloud) · [docs](https://www.sideboard.cloud/docs/) (same Fly app as the Slack relay; `relay.sideboard.cloud` stays Slack-only)

## Install

### CLI (npm)

```bash
npm i -g @sideboard-ai/cli
sideboard detect
```

### Desktop

Download the latest **Apple Silicon** Mac build from [GitHub Releases](https://github.com/mattlevine/sideboard/releases/latest):

https://github.com/mattlevine/sideboard/releases/download/v0.1.153/Sideboard-0.1.153-arm64.dmg

> Direct download links only work while the GitHub repo (or its releases) are **public**.

The app auto-updates via `electron-updater` (checks on launch and every 4 hours; shows an in-app + OS notification when a new version is available, then **Restart to update** when the download finishes — never restarts mid-session silently).

#### Releasing

```bash
# One-time: copy Brightsy (or your) Developer ID + npm token into apps/desktop/.env
cp apps/desktop/.env.example apps/desktop/.env

# From repo root — bump versions, publish npm + Mac desktop, tag
pnpm release                 # patch → @sideboard-ai/cli + @sideboard-ai/core + desktop
pnpm release minor
pnpm release patch npm       # CLI + MCP only (core ships `sideboard-mcp`)
pnpm release patch mac       # desktop GitHub Release only
pnpm release patch all never # dry-run / local artifacts
```

Pushing a `v*` tag to origin is what runs [`.github/workflows/release.yml`](.github/workflows/release.yml) (npm OIDC + Mac Electron). There is no **Run workflow** button. Worktree / chat agents: bump, commit the Release, merge, then retarget `vX.Y.Z` onto that commit and push the tag — do **not** pack Electron in the turn. Watch **Actions → Release**; use `/long-running` only to wait on `gh run watch`. Local `pnpm release patch mac` is for a human at a real terminal.

After `npm i -g @sideboard-ai/cli`, MCP is `sideboard mcp` (or `npx sideboard-mcp`).

### Agent CLIs

Sideboard shells out to each agent’s CLI. Install the ones you want on your `PATH`, then authenticate. `sideboard detect` reports what’s available.

#### Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude          # complete login on first run
```

Docs: [code.claude.com/docs/en/install](https://code.claude.com/docs/en/install)

#### Codex

```bash
npm install -g @openai/codex
codex           # complete login / auth on first run
```

Docs: [github.com/openai/codex](https://github.com/openai/codex)

#### OpenCode

```bash
# Recommended (macOS / Linux)
curl -fsSL https://opencode.ai/install | bash

# Or via npm (package name is opencode-ai, not opencode)
npm install -g opencode-ai@latest
opencode auth login
```

Docs: [opencode.ai/docs](https://opencode.ai/docs)

#### Cursor

Local Cursor agents via the official SDK (same approach Conductor uses — not a CLI spawn).

Set the key in the desktop app under **Settings → Agents → Cursor** (also appears under **Settings → Environment** as `CURSOR_API_KEY`), or in your shell:

```bash
export CURSOR_API_KEY="cursor_..."   # https://cursor.com/dashboard/integrations
sideboard detect                     # cursor should show authenticated
```

Shell env wins if both are set. Docs: [cursor.com/docs/sdk/typescript](https://cursor.com/docs/sdk/typescript)

Verify everything Sideboard can see:

```bash
sideboard detect
```

## Quick start

The loop that matches why Sideboard exists: board → send → inspect → attach when you want the native CLI → land when ready.

```bash
sideboard detect
sideboard new --from branch:main --agent claude
sideboard ls
sideboard send <thread> "add a README note"
sideboard diff <thread>
sideboard attach <thread>        # drop into the native CLI, same session
sideboard land <thread>          # interactive y/N; no --yes in v1
sideboard adopt --from-conductor # import Conductor workspaces + history
```

Aliases: `side` → `sideboard`.

For the global board, live orchestration, and the code + data desktop layout, run the app.

## Desktop — union of agent code and data

A worktree chat is **repo + worktree + CMS** in one view:

| Zone | Layer | What it is |
|------|-------|------------|
| **Far right** | Repo | Connected git worktree — Files / Changes / CI / Review, Setup / Run / Terminal |
| **Chat** | Worktree agent | The thread driving that worktree. Nested Task / Agent / `spawn_agent` work shows as a card under the parent tool. |
| **Structure column** (tabs) | CMS / data | Artifacts, schema → form/table, file manager — content and files the agent needs you to see or edit |

Agents open structure tabs via MCP (or you reopen them from message chips). Tabs stick per chat until you close them.

Token counts always show on message chips, the thread Σ total, and worktree hover spend. **Settings → Advanced → Show cost (when available)** (off by default) also shows provider-reported USD when the agent CLI reports it (Claude, Cursor, OpenCode, Brightsy). Codex streams tokens only — no USD.

### Schema → form (not “a CMS product”)

`present_schema` takes **JSON Schema + optional `schemaUi`** and renders a filterable table and/or form. The agent can **create the schema** for whatever it needs — articles, feedback, config, checklists, research rows — then hand you a UI to fill or correct it. That might back a CMS, feed a **static website** build in the worktree, or be a one-off shape for the turn. A markdown table in chat is enough to *read* the data; use this tool when you need to filter, edit, or persist rows (including after a markdown table, if you ask for an editable one).

Same chrome for every backend:

- Typed fields from the schema; TipTap rich text + markdown via `schemaUi`
- Relationships (has-one / has-many) with in-pane navigation
- Draft / publish only when the resource declares content states — otherwise save-only
- Media fields jump to a Files tab in **select mode**, then return to the form

| Provider | When |
|----------|------|
| `inline` | Agent embeds `resource` / `records` in the tool call — any use, no extra account |
| `brightsy` | Optional — logged-in Brightsy team + `resource_id` |

### Artifacts & file manager

- **`present_artifact`** — HTML / SVG / markdown / React, or **`type=log`** (append-only stream; same `artifact_id`, new lines only)
- **`present_files`** — browse / upload / pick (`memory` demo, or optional Brightsy storage). Drag from Finder or from Sideboard’s worktree file list. Multiple Files tabs can sit beside multiple schema tabs.

New datasources implement list/get/save (and optional publish). They do not fork the column UI.

## MCP — agents that can see the fleet

Install the CLI (ships the stdio server), then register it with your MCP client:

```bash
npm i -g @sideboard-ai/cli
sideboard mcp          # same as: npx sideboard-mcp
```

Sideboard desktop **auto-injects** this MCP into Claude / Cursor / Codex / OpenCode turns (orchestration and worktree). The packaged Mac app also merges a `sideboard` entry into `~/.cursor/mcp.json` (and `~/.claude.json` if it already exists) so Cursor IDE / Claude Code see the same fleet and store as Sideboard.app (`SIDEBOARD_APP_DATA` → `~/Library/Application Support/sideboard`). Use the steps below when you want to register MCP yourself — Claude Code in a project, Cursor IDE Agent, Codex CLI, etc.

Pin `SIDEBOARD_APP_DATA` if a `sideboard` binary on PATH should still hit this Mac’s Sideboard store.

### Connect Claude Code

```bash
# All projects (user scope)
claude mcp add --scope user sideboard -- sideboard mcp

# Or one project only (omit --scope, or use --scope project)
claude mcp add sideboard -- sideboard mcp
```

Confirm with `/mcp` inside a Claude session, or `claude mcp list`.

### Connect Cursor

Add a project or global MCP entry (Cursor → Settings → MCP, or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sideboard": {
      "command": "sideboard",
      "args": ["mcp"],
      "env": {
        "SIDEBOARD_APP_DATA": "/Users/you/Library/Application Support/sideboard"
      }
    }
  }
}
```

Prefer `npx -y sideboard-mcp` for `command` / `args` if `sideboard` is not on Cursor’s PATH. Packaged Sideboard.app writes the absolute `node` + extraResources path here on launch (merge, does not clobber other servers).

### Connect Codex

Add to `~/.codex/config.toml` (or pass equivalent `-c` overrides):

```toml
[mcp_servers.sideboard]
command = "sideboard"
args = ["mcp"]

[mcp_servers.sideboard.env]
SIDEBOARD_APP_DATA = "/Users/you/Library/Application Support/sideboard"
```

Sideboard does not rewrite `~/.codex/config.toml`; add the block above (or equivalent `-c` overrides) so Codex CLI shares the packaged store.

### Connect OpenCode

Add to `~/.config/opencode/opencode.jsonc` (or a project `opencode.jsonc`) under `mcp`, or merge via `OPENCODE_CONFIG_CONTENT`:

```json
{
  "mcp": {
    "sideboard": {
      "type": "local",
      "command": ["sideboard", "mcp"],
      "enabled": true
    }
  }
}
```

### What agents get

Once connected, agents get tools to:

- **Discover** — `list_board` (worktree Kanban: New → Draft → Review → Merged; `create_thread` adds a worktree), `list_workspaces` (path + GitHub slug), `list_branches` / `list_prs` (`queue=review` for the unclaimed `eng-review` inbox — PRs for assigned ticket work; a team like `engineering-team` is not a claim; also `state`, `label`, `reviewer` = `me` / `unassigned` / login) / `list_issues` (Linear, AbleTime MCP, or GitHub), `list_threads`
- **Linear tickets** — `linear_list_teams`, `linear_search_issues` / `list_issues` (`query`, `assignee` = `me` / `unassigned` / `all` / user, `limit` default 40 max 250; raise `limit` or tighten `query` when `truncated`), `linear_get_issue`, `linear_create_issue`, `linear_update_issue`, `linear_comment` (Settings → Issues OAuth; reconnect if you connected before write access). Linear / AbleTime mutation tools register only when that account is connected.
- **AbleTime tickets** — `abletime_orientation`, `abletime_list_projects`, `abletime_list_tasks`, `abletime_search_tasks`, `abletime_get_task`, `abletime_create_task`, `abletime_ensure_task` (Settings → Issues personal access token → hosted MCP). When AbleTime is the preferred issue source, starting work without a ticket auto-creates one to track against.
- **Workspaces** — `add_workspace` / `remove_workspace`
- **Worktree chats** — `create_thread` → `send_to_thread` → `wait_for_turn` / `get_turn_result` (from a Sideboard orchestration chat, omit `parentThreadId` — MCP binds the child to that chat; do not invent uuids). A ticket, PR, or named branch may have only one live worktree — `create_thread` returns that thread (`alreadyStarted`) instead of a second checkout; default-branch create still opens a new isolated worktree. `wait_for_turn` returns within ~45s with `stillRunning` + live `progress` while the child is still working — call it again; do not assume a hang. `fork_worktree` / `fork_chat` (optional agent; Auto model unless pinned via `list_models`; `fork_chat` also forks Global orchestration chats); `stop_thread` force-stops (kills in-flight turn and clears the prompt queue); `send_to_thread` accepts optional `force_stop` to interrupt+replace; `archive_thread`, `restore_thread`
- **Present structure (desktop)** — `present_artifact` (HTML/SVG/MD), `present_schema` (JSON Schema → table/form; agent can invent the schema), `present_files` (file manager); tabs beside chat, git repo stays on the far right
- **Ask the user** — `ask_user` (composer multiple-choice when work is blocked on a concrete choice — not greetings or “what next?” menus). Agents explain options in chat first; Sideboard shows the picker and mirrors questions in the transcript.
- **Schedules** — `list_schedules` / `create_schedule` / `update_schedule` / `delete_schedule` / `run_schedule` (orchestration profile). Jobs fire only while Sideboard.app is running. Overnight: **Settings → Advanced → Caffeinate while schedules are enabled**, or `set_caffeinate`.
- **Setup / run** — `run_setup` (also runs automatically on new worktrees), `list_run_scripts`, `run_dev_script`, `stop_dev_script`
- **Inspect / review / PRs** — `get_diff`; `get_pr_checks` (snapshot); `request_review` (opens a Review chat tab on a worktree thread); `ask_git` (commit & push, draft PR, resolve conflicts, merge — same prompts as the desktop git buttons). If a goal is given (Greptile 5/5, CI green), the worktree agent watch-fix-pushes until it lands. Merge only when the user explicitly asked.
- **Keep the Mac awake** — `set_caffeinate` from an orchestration chat (released when that chat closes). Independent Advanced toggles: while agents are running, while Slack Listen is on, and while schedules are enabled.

Ready-for-review land (`confirm_land`) and `purge_thread` stay human-only. Coordinators commit, push, and open PRs by asking the worktree agent. They merge only when the user explicitly asked.

## Settings

Desktop Settings opens on **Agents**. Connections are owned by Sideboard, not per-agent MCP.

| Panel | What |
|-------|------|
| **Agents** | Default agent, model, and effort; your roles and notes (how to find tickets and review PRs); then harness setup (Claude, Codex, OpenCode, Cursor, Brightsy) |
| **Projects** | Per-repo role overrides and notes (empty roles inherit Agents) |
| **Git** | How this Mac and worktree agents authenticate git (`gh`, SSH, or a PAT) |
| **Issues** | Preferred tracker plus Linear and AbleTime |
| **Remote** | Slack — remote-control this Mac |
| **Connectors** | Optional project services: Vercel, Supabase, PostHog, Sentry |
| **Environment** | Extra env vars injected into agent runs |
| **Schedules** | Local jobs that wake an orchestration chat |
| **Advanced** | Cowboy mode, caffeinate, show cost, Brightsy MCP inject |
| **History** | Archived chats |

## Git

**Settings → Git.** Pick how Sideboard and worktree agents authenticate GitHub on this Mac:

- **Auto** (recommended) — HTTPS in the agent process using this Mac’s `gh` login
- **gh CLI auth** — rewrite `git@github.com` remotes to HTTPS; git/gh use a Sideboard credential file
- **SSH** — keep SSH remotes (batch-mode; fails instead of prompting Keychain)
- **Personal access token** — store a PAT on this Mac (not in the agent environment)

If git/gh fail with auth errors, run `gh auth login` on this Mac or set a PAT here. Agents should not wait for a Keychain dialog.

## Linear

**Settings → Issues → Linear → Connect via browser.** Sideboard stores the OAuth token on this Mac and uses it for Create-from / Link issue and MCP ticket tools (`linear_create_issue`, `linear_update_issue`, `linear_comment`). A personal API key still works if you paste one.

OAuth requests `read,write`. Linear’s OAuth app page has no scopes checklist — Sideboard sets them in `LINEAR_OAUTH_SCOPES`. If you connected when Sideboard was read-only, **Disconnect and Connect via browser** so Linear re-consents.

Desktop Connect uses Chromium networking so corporate VPNs/proxies that break Node `fetch` (`Error invoking remote method 'startLinearOAuth': fetch failed`) still reach `api.linear.app`. CLI `sideboard linear login` still uses Node fetch — set `HTTPS_PROXY` or connect off-VPN.

## AbleTime

**Settings → Issues → AbleTime.** Enable **Agent access (MCP)** in AbleTime (Settings → Integrations → API Keys), then paste a personal access token from Profile → API Access (`apt_…`). Sideboard talks to AbleTime’s hosted MCP (`POST https://track.abletime.com/api/public/v2/mcp`) — list/search/create tasks, and **ensure** a task exists to track against.

Set **Issue source** to AbleTime. Create-from / Home list AbleTime tasks. Starting a thread from the default branch (no ticket) auto-creates an AbleTime task and attaches it. Orchestration tools: `abletime_orientation`, `abletime_ensure_task`, `abletime_create_task`, and the list/search/get variants.

```bash
sideboard linear login
sideboard linear disconnect
```

Callback URL for the Sideboard Linear OAuth app: `http://127.0.0.1:19848/callback`. Override the client with `SIDEBOARD_LINEAR_CLIENT_ID` (secret optional — the desktop uses PKCE). You will not see that baked app under *your* Linear **API → OAuth applications** — it lives on Sideboard’s Linear workspace. Authorized copies show under workspace **Settings → Applications** after you connect.

## Slack

Slack is the remote surface for the **same local orchestrator** — not a cloud workspace. DMs and `@mentions` go to the Global orchestrator on this Mac; it can `slack_post` a coworker to review a PR a worktree just pushed; their reply is copied back into your orchestration chat as information (not a command) and the orchestrator continues. Replies from the orchestrator post back to Slack.

Each MacBook is its own destination (Personal, Work, …).

```
┌────────────────┐     hosted relay      ┌──────────────────┐
│ Slack          │ ─────────────────────► │ Sideboard Mac    │
│ DM / @mention  │     (WSS)              │ (Personal/Work)  │
└────────────────┘ ◄── chat.postMessage ──└────────┬─────────┘
                                                   │
                                                   ▼
                                          Global orchestrator → worktrees
```

**What stays on this Mac.** Agents, worktrees, repos, and secrets — including anything only reachable on the corporate VPN. **What leaves:** Slack message text, via `relay.sideboard.cloud`. The relay does not host worktrees.

Keep the desktop app running after you connect a workspace. Slack cannot reach the fleet if this machine is asleep. For unattended Listen, enable **Settings → Advanced → Caffeinate while Slack Listen is on**, or turn on `set_caffeinate` from the orchestration chat when you step away (and off when you are done).

### Connect

**Settings → Remote → Slack**

1. **Add via browser** — installs the official Sideboard Slack app into a workspace (use this; paste-only bot tokens cannot prove which Slack user owns the Mac). Until **Manage Distribution → Activate Public Distribution** is on, Slack sends that flow to the app’s home workspace (`brightsy.slack.com`) and will not list other teams. Slack requires an HTTPS redirect; Sideboard uses `https://relay.sideboard.cloud/slack/callback`. The relay exchanges the OAuth code (the client secret stays on the server). Sideboard polls until that finishes.
2. **This Mac** — name the destination (`Personal`, `Work`, …). Each Mac gets a stable id; both can stay online at once.
3. Listening starts when a workspace is connected. Status should show `Relay connected · Personal` (or your name).

Use **Cancel** in Settings if you close the Slack tab — closing the browser does not stop the wait.

Someone else messaging the bot needs **their** Sideboard online — messages route to the Slack user who connected that Mac, not to tabs on yours.

Env overrides (optional): `SIDEBOARD_SLACK_RELAY_URL` (e.g. local `ws://127.0.0.1:8787/slack/desktop`), `SIDEBOARD_SLACK_OAUTH_REDIRECT` (defaults to `https://relay.sideboard.cloud/slack/callback`).

### Talk to a Mac from Slack

| Where | What to type |
|-------|----------------|
| **DM the bot** | `work: Check the failing CI` |
| **Channel / thread** | `@sideboard work: Check the failing CI` |

The destination prefix is the **This Mac** name (case does not matter). Mentions are stripped before routing, so `work:` is what selects the Mac.

- One Mac online → it handles unprefixed messages.
- Personal and Work both online → unprefixed messages go to whichever claims first. Replies are signed (`Work: …`) so you can see who answered, then address that Mac with `work:` / `personal:`.
- A follow-up message interrupts the in-progress turn and starts a new one. Send `stop` to cancel without a replacement prompt.
- Closing the Slack coordinator chat (or every Global tab) does not disable Listen. The next DM/@mention opens a new Global chat.
- Long turns post one `Thinking…` message after ~20s and edit it with the current tool. The final answer replaces that message.
- If a DM never gets 👀, quit and reopen Sideboard so Listen re-registers. You do not need an orchestration chat already open.

### CLI

```bash
sideboard slack teams
sideboard slack login          # browser OAuth
sideboard slack listen         # same listen path as the desktop
```

Agents can also call MCP `list_teams` / `slack_list_channels` / `slack_list_users` / `slack_search` / `slack_read` / `slack_post` / `slack_replies` once a workspace is connected (optional `github_url` for a PR or permalink).

If someone replies in Slack to a message Sideboard posted, that reply is copied into the orchestration chat as information (not a command) and the posting chat gets a follow-up turn. If you were talking to the orchestrator from Slack, Sideboard FYIs you there too.

More detail: [docs/remote-integrations.md](docs/remote-integrations.md).

## Connectors

**Settings → Connectors.** Optional tokens for project services. Agents use official CLIs (or the PostHog HTTP API) with env injected into the worktree — not vendor MCPs.

| Service | Env | Agent path |
|---------|-----|------------|
| Vercel | `VERCEL_TOKEN` | `vercel` CLI |
| Supabase | `SUPABASE_ACCESS_TOKEN` | `supabase` CLI |
| PostHog | `POSTHOG_PERSONAL_API_KEY`, optional `POSTHOG_HOST` | HTTP API (no first-class CLI) |
| Sentry | `SENTRY_AUTH_TOKEN`, optional `SENTRY_URL` | `sentry-cli` |

Tokens stay in the Mac vault. Disconnect from the same panel. If `vercel`, `supabase`, or `sentry-cli` is missing, **Install CLI** runs `npm i -g` (opens Terminal if npm needs sudo). Sideboard does not auto-install on Connect. Slack is **Settings → Remote**, not here.

## Scheduled orchestration

Local jobs that send a prompt to an existing Global chat, or start a new one. Sideboard.app must be running on this Mac; a sleeping machine skips until wake. For overnight runs, enable **Settings → Advanced → Caffeinate while schedules are enabled** (or `set_caffeinate` from a chat).

**Settings → Schedules**, orchestration MCP (`list_schedules` / `create_schedule` / `run_schedule`), or:

```bash
sideboard schedule ls
sideboard schedule add --prompt "Triage open PRs" --every 1h --thread <id>
sideboard schedule add --prompt "Morning standup" --cron "0 9 * * *" --tz America/Los_Angeles
sideboard schedule add --prompt "One-shot reminder" --at 2026-08-21T18:00:00-07:00
sideboard schedule run <id>
```

Omit `--thread` to open a new orchestration chat when the job fires (recurring jobs will open a new chat each run). Pass `--thread self` from an orchestration turn (or `threadId=self` in MCP) to continue that coordinator.

## Also: Brightsy

Optional hosted chat and one schema/files backend. Skip this if you use Claude, Codex, OpenCode, or Cursor. Remote control of this Mac is **Slack**, not Brightsy.

```bash
npm install -g @brightsy/cli
brightsy login
```

Then Settings → Agents → Brightsy to connect a team. That unlocks hosted chat in the agent picker (no local file edits) and `datasource=brightsy` for `present_schema` / `present_files`. Inline schema and memory files work with no Brightsy account.

`sideboard brightsy teams` / `connect-team` wrap the same team list. Worktree agents get Brightsy MCP only when you ask, or when Settings → Advanced → Inject Brightsy MCP is on.

## Monorepo

```
packages/core     # orchestrator, agents, git, MCP, store
packages/cli      # commander CLI (bins: sideboard, side)
apps/desktop      # Electron (electron-vite + React) — global board UI
```

```bash
pnpm install
pnpm --filter @sideboard-ai/core build
pnpm --filter @sideboard-ai/cli build
pnpm --filter @sideboard-ai/desktop dev
```

## Worktrees & repo config

Worktrees live **outside** the repo (Conductor-style):

```
~/sideboard/workspaces/<repo-slug>/<soccer-team>/
```

New threads pick an unused famous soccer team (e.g. `liverpool`, `ajax`) for the worktree directory and a placeholder `thread/<team>` branch — same idea as Conductor’s city nicknames. On the first agent turn, Sideboard asks the agent to rename the branch to match the task; the sidebar then shows the PR title (if any) or that branch name.

**Cowboy mode** skips the extra worktree: the chat runs in the registered project folder, which must already be on the default branch. Enable **Settings → Advanced → Cowboy mode** (off by default), then pick Cowboy from New chat → ⋯. CLI `--cowboy` and MCP `create_thread cowboy=true` also require that setting. Land is commit+push to that branch (no PR). Archiving the chat does not delete the project folder.

Override per repo in `.sideboard/settings.toml`:

```toml
[worktrees]
# root = "~/sideboard/workspaces/my-repo"

[scripts]
setup = "pnpm install"

[scripts.run.dev]
command = "PORT=${SIDEBOARD_PORT:-${CONDUCTOR_PORT:-3000}} pnpm --filter web dev"
default = true
```

Sideboard prefers `.sideboard/settings.toml` and falls back to `.conductor/settings.toml` when present (so existing Conductor-configured repos keep working). Dev scripts get both `SIDEBOARD_PORT` and `CONDUCTOR_PORT`.

New worktrees run setup automatically (create / fork / stack layer) in the background — it does not block the chat. If `[scripts] setup` is missing, Sideboard uses `.cursor/worktrees.json` `setup-worktree`, then a conventional `script/setup`, `bin/setup`, or `scripts/setup(.sh)` when one of those files exists.

### Review guidelines

If the repo already has `.claude/skills/review/SKILL.md`, Review and **Customize guidelines…** use that file. Otherwise Sideboard copies `.sideboard/review.md` into the worktree’s `.context/review.md` (or seeds that file from the stock template). It does not create a review skill. Workspace-local chat scratch (plans, drops) lives under `.context/attachments/` — same idea as Conductor’s `.context` vs committed `.sideboard/` / `.claude/` config.

### Process skills

When the same shape of work will happen again, write a Claude Code project skill at `.claude/skills/<name>/SKILL.md` and commit it. Sideboard’s composer `/name` expander, Claude Code, and `attach` all load that path — so the guide works outside Sideboard. Do not put new skills in `.sideboard/skills` (Sideboard still scans it; other agents do not). Point Codex/OpenCode at the file from `AGENTS.md`. Optional: symlink `.cursor/skills/<name>` to the Claude skill.

- **One-offs** should not create a skill. The first run is still a loop; corrections become sentences in the guide.
- **Same miss twice** → edit the skill (or `.claude/skills/review/SKILL.md` when that review skill exists, else `.context/review.md`) and rerun. Do not patch three threads and leave the process unchanged.
- After merge to the default branch, **new worktrees inherit** the file. Existing siblings need an update from that branch.

This repo’s method skill is [`.claude/skills/graph-engineering/SKILL.md`](.claude/skills/graph-engineering/SKILL.md) (`/graph-engineering`): judge first, state on disk, grow the rulebook, blind review, fix the process not the instances. A Cursor symlink lives at `.cursor/skills/graph-engineering`. Type `/graph-engineering` in the Sideboard composer to attach it.

`/long-running` is a **Sideboard product skill** — every worktree agent gets the detach-and-wait playbook (and the helper ships with the app). A committed `.claude/skills/long-running` in a repo still wins if you want to customize it.

Older threads that already point at a repo-local path keep working; new threads always use the home-dir (or configured) root.

## Safety (v1)

- Landing on the default branch is blocked, except **cowboy** chats (project folder on `main` / default; land is commit+push)
- Dirty worktrees require an explicit land confirm (auto-commit then push/PR)
- Fork PRs are not landed in v1
- No `--yes` on `land`

## License

Apache-2.0 — see [LICENSE](LICENSE). Contributions welcome under [CONTRIBUTING.md](CONTRIBUTING.md).
