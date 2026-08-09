# Remote integrations — Slack, Discord, …

Sideboard’s **CLI** and **MCP server** are first-class control surfaces. They do **not** require the desktop app or Brightsy.

You can reach the same fleet two ways:

1. **DIY Slack (or Discord) connector** — your Slack app + bot process calling CLI/MCP (this doc, below).
2. **Brightsy remote orchestrator** — Brightsy cloud Slack/Discord/Teams → desktop cloud-connect daemon → orchestration chat → MCP (also this doc).

Brightsy is optional. DIY never talks to Brightsy’s `/api/v1beta/desktop/*` API.

| Path | Who hosts the chat hop | Who runs Sideboard |
|------|------------------------|--------------------|
| **DIY Slack connector** | Your Slack app + your bot process | Same machine (or always-on box) runs `sideboard` CLI / `sideboard mcp` |
| **Brightsy (optional)** | Brightsy cloud + your Slack/Discord/Teams connection | Desktop app daemon polls Brightsy desktop tasks → orchestration chat → MCP |

---

## Build your own Slack connector

### Architecture (DIY)

```
┌─────────────┐     Events API / slash     ┌──────────────────────┐
│ Slack       │ ─────────────────────────► │ Your connector       │
│ workspace   │ ◄──── chat.reply / posts ─ │ (Bolt, Cloudflare    │
└─────────────┘                            │  Worker, Express…)   │
                                           └──────────┬───────────┘
                                                      │
                         ┌────────────────────────────┼────────────────────────────┐
                         ▼                            ▼                            │
               ┌─────────────────┐          ┌─────────────────┐                    │
               │ sideboard CLI   │          │ sideboard mcp   │                    │
               │ (mechanical)    │          │ (judgment)      │                    │
               └────────┬────────┘          └────────┬────────┘                    │
                        └──────────────┬─────────────┘                             │
                                       ▼                                           │
                             ┌─────────────────┐      draft PR                     │
                             │ Worktree agents │ ───────────────────────────────►  │ GitHub
                             │ on registered   │                                   │
                             │ workspaces      │                                   │
                             └─────────────────┘                                   │
                                       │                                           │
                    sideboard://thread/<id> ───────────────────────────────────────┘
                    (deep link back into desktop)
```

**Prerequisites on the host that runs Sideboard**

1. `@sideboard-ai/cli` installed (`npm i -g @sideboard-ai/cli`)
2. Agent CLIs you want (`claude`, `codex`, …) installed and authenticated — `sideboard detect`
3. Workspaces registered (desktop **Add workspace**, or MCP `add_workspace`)
4. Process that can exec `sideboard` / speak MCP stdio (same user machine as the worktrees, or a dedicated always-on checkout host)

The desktop app is optional for DIY: CLI/MCP talk to the same local store/orchestrator. Deep links (`sideboard://thread/<id>`) open chats in the desktop when it is installed.

### Choose a connector shape

#### A. Thin bot (CLI only)

Best when the Slack command already encodes intent (“spin a Claude thread on `brightsy-ai` and fix CI”).

```
Slack slash / message
  → your handler
  → sideboard new --from branch:main --agent claude --repo <path>
  → sideboard send <thread> "<user text>"
  → post thread id + sideboard:// link (+ optional PR URL later)
```

Zero agent tokens in the connector. Use MCP `wait_for_turn` (or poll `sideboard ls`) if you need to post when the turn finishes.

#### B. Coordinator bot (MCP)

Best when Slack asks open-ended questions (“which repos are dirty?”, “fan this out to three agents”).

```
Slack message
  → your handler
  → MCP client → sideboard mcp (stdio)
  → list_workspaces / create_thread / send_to_thread / wait_for_turn / get_diff
  → summarize reply back to Slack
```

Point any MCP-capable runtime at `sideboard mcp` (Claude Code as a local coordinator, a small Node MCP client, etc.). Do **not** expose land / merge / purge as automated bot actions.

### Create the Slack app

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.
2. **OAuth & Permissions** — Bot token scopes (typical minimum):
   - `app_mentions:read`, `chat:write`, `commands`, `im:history`, `channels:history` (as needed for your UX)
3. **Socket Mode** (simplest for a laptop/daemon) **or** HTTP Request URL (for a public Worker / VPS).
   - Socket Mode: enable + generate App-Level Token (`connections:write`).
4. **Slash Commands** (optional) — e.g. `/sideboard` with request URL pointing at your connector, or rely on @mentions.
5. Install the app to your workspace; copy **Bot User OAuth Token** (`xoxb-…`).
6. Keep the connector process running wherever Sideboard runs (or can SSH/exec to that host).

Slack never needs to reach your git worktrees directly — only your connector does.

### Minimal request loop

Pseudocode for a thin connector:

```text
on Slack message (or /sideboard <prompt>):
  1. AuthZ: allowlist Slack user ids / channels
  2. Map channel → default workspace path (config table)
  3. Ensure a thread exists:
       sideboard new --from branch:main --agent claude
       # or reuse a sticky orchestration thread id from your store
  4. sideboard send <threadRef> "<prompt>"
  5. Reply in Slack with:
       - short ack
       - sideboard://thread/<full-id>
       - optional: "I'll post when the turn finishes" + background wait
  6. (async) wait_for_turn via MCP → post get_turn_result summary / PR link
```

Mechanical CLI examples:

```bash
sideboard ls
sideboard new --from branch:main --agent claude
sideboard send <thread> "fix the failing test"
sideboard diff <thread>
# land stays human-gated — do not automate:
# sideboard land <thread>
```

MCP tools commonly used by a coordinator:

- `list_workspaces` / `list_threads` / `get_thread`
- `create_thread` / `send_to_thread` / `wait_for_turn` / `get_turn_result`
- `list_models` (optional `agent` — only when pinning a model; default is Auto)
- `fork_worktree` / `fork_chat` (optional `agent`; leave `model` unset for Auto unless you have a reason)
  - `fork_chat` also forks **Global orchestration** chats (new orchestration tab) — remote coordinators use this to continue after session limits
  - `fork_worktree` is worktree-only
- `stop_thread` (interrupt) — `send_to_thread` also accepts `force_stop`
- `get_diff`
- `request_review` (worktree thread → Review chat tab; then `wait_for_turn`)

Ask worktree agents to open draft PRs via `send_to_thread` (`gh pr create --draft`), not via a host land tool.

### Mapping Slack → Sideboard

Keep a small config owned by the connector (env / JSON / Secrets):

| Slack | Sideboard |
|-------|-----------|
| Channel `#eng-sideboard` | Default `repoPath` / workspace |
| User allowlist | Who may create/send threads |
| Optional “sticky” thread id | Reuse one orchestration chat vs new worktree per request |
| Agent default | `claude` / `codex` / … |

Deep links from `list_threads` look like `sideboard://thread/<uuid>` — post them in Slack so people can jump into the desktop chat.

### Hosting options

1. **Same Mac as Sideboard desktop** — Connector as a launchd/systemd user service; Socket Mode; simplest.
2. **Always-on Linux box** — Install CLI + agents + clone/register workspaces; connector runs there; optional desktop elsewhere for UI only.
3. **Cloud bot + local Sideboard** — Bot in Cloudflare/Fly receives Slack; calls your host over SSH, Tailscale, or a private HTTP shim that shells to `sideboard`. Do not expose the orchestrator store to the public internet.

DIY usually keeps the bot **next to** Sideboard (or on a private network to it). Brightsy’s “cloud task → desktop poll” pattern is specific to Brightsy (next section).

### Example patterns

1. **Slash → new worktree** — `/sideboard fix flaky CI in brightsy-ai` → `create_thread` + `send_to_thread` → Slack gets `sideboard://` + later PR URL.
2. **Mention → sticky orchestrator** — One long-lived orchestration thread with Sideboard MCP; Slack messages append turns; replies summarize fleet status.
3. **Channel → repo binding** — `#repo-web` always targets that workspace’s path; no repo argument in the prompt.
4. **CI / cron** — Same CLI/MCP without Slack; results as draft PRs.

---

## Optional: Brightsy remote orchestrator (Slack / Discord / Teams)

Brightsy chat channels can drive Sideboard on your machine across **all registered workspaces** — no need to be at the keyboard. Slack is the best-tested path; Discord and Microsoft Teams use the same cloud-task flow but are less battle-tested.

You do **not** need Brightsy to ship a Slack integration — use the DIY path above. This section is for teams already on Brightsy.

### How the pieces fit together

```
┌─────────────────┐     chat      ┌──────────────────┐
│ Slack / Discord │ ────────────► │ Brightsy cloud   │
│ / Teams         │               │ agent + desktop  │
└─────────────────┘               │ task             │
                                  └────────┬─────────┘
                                           │ desktop task
                                           ▼
                                  ┌──────────────────┐
                                  │ Cloud connect    │
                                  │ daemon (poll ~5s)│
                                  └────────┬─────────┘
                                           │ send + wait
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     │
           ┌─────────────────┐   ┌─────────────────┐             │
           │ Orchestration   │   │ Local orch chat │             │
           │ chat (Brightsy- │   │ (desktop New    │             │
           │ marked)         │   │  chat)          │             │
           └────────┬────────┘   └────────┬────────┘             │
                    │ tools               │ tools                │
                    └──────────┬──────────┘                      │
                               ▼                                 │
                     ┌─────────────────┐                         │
                     │ Sideboard MCP   │                         │
                     │ fleet control   │                         │
                     └────────┬────────┘                         │
                              │ create / send / wait             │
                              ▼                                  │
                     ┌─────────────────┐      draft PR / push    │
                     │ Worktree agents │ ──────────────────────► │ GitHub
                     │ (repo threads)  │                         │
                     └─────────────────┘                         │
                              │                                  │
           reply text ────────┘                                  │
           (cloud path only) ────────────────────────────────────┘
                               back to Brightsy → Slack
```

**Path through a request**

1. **Chat → Brightsy** — A human asks in Slack (or Discord/Teams). Brightsy’s cloud agent receives it and, when desktop Sideboard access is enabled, creates an inbound desktop task.
2. **Daemon → orchestration** — Sideboard’s cloud-connect daemon polls Brightsy, routes the task to the singleton Brightsy-marked orchestration chat (soccer nickname in the UI; identity on `sourceRef`), and waits for the turn.
3. **Orchestrator steers the fleet** — That chat uses Sideboard MCP (`list_workspaces`, `create_thread`, `send_to_thread`, `wait_for_turn`, …). It does not live in a project worktree; it oversees them.
4. **Worktree agents build** — Child threads are real git worktrees under registered workspaces. They code, run tools, and open draft PRs when asked. Deep links: `sideboard://thread/<id>`.
5. **Reply back up** — Orchestrator text is submitted as the Brightsy task response and relayed back to Slack.

**Two ways in**

| Path | Entry | Then |
|------|--------|------|
| **Cloud** | Slack → Brightsy → cloud-connect daemon | Brightsy-marked orchestration chat → same MCP + worktree agents |
| **Local** | Sideboard Orchestration → New chat | Same MCP + worktree agents (no Brightsy hop) |

**Orchestration** is a first-class home-less surface: multiple orchestration chats, each using a synthetic empty cwd and Sideboard/Brightsy MCP tools only (no Edit/Write/Bash on a home checkout). Brightsy cloud always routes to one designated chat (identity on `sourceRef`, not the tab title). The Home board lists those orchestration chats (last responses) — not a fan-out console.

Sideboard uses Brightsy’s existing `/api/v1beta/desktop/*` cloud-to-local API. If the cloud coordinator is already running or queued, the daemon returns a fixed non-AI busy reply (no queue, no sibling chat) so the cloud agent can decide what to do next. To interrupt an in-progress turn, the cloud agent can send a follow-up desktop task whose first line is exactly `SIDEBOARD_FORCE_STOP` (optional new request on later lines); the daemon stops the coordinator immediately—before the serialized task queue—then either confirms the stop or runs the remainder.

### Setup (desktop UI — preferred)

1. `brightsy login`, then in Sideboard: **Settings → Agents → Brightsy** and check the teams you want.
2. Same panel: turn on **Cloud messages / remote orchestrator** and pick a coordinator agent (`claude` recommended).
3. In Brightsy, connect Slack, Discord, and/or Teams on the agent, and link your chat identity under User Settings → Integrations.
4. Keep the Sideboard desktop app running. It polls Brightsy desktop tasks and routes them to the Global coordinator.

Once enabled, the same panel shows live status (listening / starting / error) and the list of registered workspaces the coordinator can reach. Turning the switch off stops the daemon and disables Brightsy desktop access for that account.

### Setup (CLI)

```bash
brightsy login
sideboard brightsy connect-team <slug>
sideboard connect --agent claude
```

`--repo` is deprecated/ignored — the daemon always uses the Global workspace coordinator and still exposes **all** registered workspaces. `--agent` accepts `claude|codex|opencode|cursor` (not Brightsy — chat-only). Other flags: `--poll-ms <ms>` (default 5000), `--no-enable-access`, `--no-allow-always`.

Also covered in the root [README](../README.md) under **Optional: Brightsy remote orchestrator**.

### What the coordinator can/can't do

- Can: `list_workspaces`, list/create/send threads across workspaces, wait for turns, read diffs.
- Can't: `confirm_land` or purge — those stay human-only, from the desktop app or CLI directly.
- Can't: edit a home git checkout — Global chats have no repo worktree.

Any inbound task Brightsy marks `awaiting_confirmation` is auto-approved by the daemon as soon as it's seen — once connect is running there's no extra approval step per message.

---

## Safety (both paths)

- Keep **merge / land / purge** behind a human (desktop or interactive CLI).
- Treat inbound Slack (or Brightsy chat) as untrusted; allowlist users/channels; don’t pipe raw text into land.
- Prefer **draft PRs** from worktree agents.
- Rate-limit creates; cap concurrent threads per channel (DIY).
- Log Slack user → Sideboard thread id for audit (DIY).

## Related

- Root [README](../README.md) — product overview + Brightsy optional sections
- [Agent adapters](agent-adapters.md) — Claude / Codex / OpenCode / Cursor
- [Compare](COMPARE.md) — how Sideboard differs from locked multi-agent UIs
