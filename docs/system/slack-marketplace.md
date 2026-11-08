# Slack Marketplace

How Sideboard meets Slack’s [Marketplace review prerequisites](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide/#prerequisites) and [guidelines](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements). Fill **Answer** only after that row is actually met — that text is what we paste into Slack’s submission form.

Two different bars:

| Bar | What it unlocks |
|-----|-----------------|
| **Public Distribution** (unlisted) | Other workspaces can Add to Slack. Needed before Marketplace. Today the install still lands on `brightsy.slack.com` until this is on. Does **not** remove the OAuth banner. |
| **Slack Marketplace listing** | Discoverable, reviewed. **Only this** clears “App is not approved by Slack” on the OAuth screen. Prerequisites below. Review is ~10 business days preliminary + up to 10 weeks functional. |

The red **App is not approved by Slack** copy on `slack.com/oauth/v2/authorize` is Slack’s warning for every unlisted distributed app. There is no dashboard toggle, scope change, or Sideboard code path that removes it. Users can still Allow. If Marketplace is off the table, live with the banner (or use a separate **internal** app created inside that one workspace, which is a different client id — not the baked Sideboard app).

Sources: [review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide), [distribution](https://docs.slack.dev/app-management/distribution/), [guidelines](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements).

## Go / no-go (do this first)

Coding-from-Slack is an accepted Marketplace category. [Cursor’s Slack app](https://slack.com/marketplace/A08SKDT6QUW) (`@Cursor` → cloud agent VM → PR) is listed. Slack’s banned line is **remote execution via a downloadable third-party script** (terminal commands from Slack), not “an agent that writes code.”

Sideboard is the same *job* as Cursor Slack with a different *runtime*: messages go to the user’s already-running Mac, not Anysphere’s VM. That is the remaining review risk (looks more like remote control of a machine). Framing that helps: no downloadable shell script; compute stays on the Mac they installed; relay carries message text only.

**Decision:** Marketplace is **not** off the table. We still do **not** need it to install on other teams — Public Distribution is enough. Marketplace is the only way to drop the “not approved” OAuth banner. Skip the listing unless that banner (or discovery) matters; if we submit, copy Cursor’s shape (LLM disclaimer, landing, scopes we can demo) and be explicit that agents run on this Mac.

Also forbidden: `search:read`, using Slack data to train LLMs, apps with **&lt; 5 active workspaces** and **&lt; 10 weekly active users**.

## Plan

Work in this order. Do not submit until the prerequisite table is all **met**.

### 1. Scopes (code + Slack app dashboard)

Marketplace rejects `search:read` and dislikes broad user `*:history` without a testable use case.

| Scope (today) | Keep? | Why / change |
|---------------|-------|----------------|
| Bot `app_mentions:read` | Yes | Route `@Sideboard` |
| Bot `im:*` / `mpim:*` | Yes | DMs / group DMs to the orchestrator |
| Bot `chat:write`, `chat:write.public`, `reactions:write` | Yes | Replies, post to public channels the bot is not in, seen reaction |
| Bot `channels:read` / `groups:read` / `users:read` | Yes | MCP list channels/users; resolve `#name` / `@user` |
| Bot `channels:history` / `groups:history` | Yes | MCP `slack_read` + `slack_replies` in channels the bot is in |
| Bot `team:read` | **Dropped** | Workspace name comes from `auth.test` |
| Bot `users:read.email` | Yes | `users.lookupByEmail` for `slack_post to=email` |
| User `channels:read` + `*:history` + `users:read` | **Dropped** | Reads use the bot token. User history is unsuitable when the bot already has the same history. |
| User `chat:write` | **Dropped** | Posts as `@Sideboard` with the bot token |
| User `search:read` | **Dropped** | Unsuitable for Marketplace; MCP `slack_search` removed |

OAuth requests bot scopes only (`docs/slack-app-manifest.yaml`, `packages/core/src/slack/oauth.ts`). The public page is `/slack/` (Settings → Collaboration). It does not publish an Add to Slack URL. **Still apply the manifest in the Slack dashboard** — every workspace must reinstall.

### 2. Public Distribution

Slack dashboard → **Manage Distribution** → complete their SSL/OAuth checklist → **Activate Public Distribution**.

- OAuth redirect URLs are `https://relay.sideboard.build/slack/callback` and `https://relay.sideboard.cloud/slack/callback`. New builds send the `.build` host. Slack matches the redirect exactly, so both stay on the app.
- Drop `http://127.0.0.1:19847/slack/callback` from the **production** redirect list (local override via `SIDEBOARD_SLACK_OAUTH_REDIRECT` is enough).
- Confirm **Add to Slack** URL works from a workspace that is **not** Brightsy.

### 3. Pages on www.sideboard.build

Marketplace landing must be a **public web page for the Slack app**, not GitHub. Privacy + support must be linked from it, no login.

| Page | URL (proposed) | Must include |
|------|----------------|--------------|
| Slack landing | `/slack/` | Collaboration: notify a teammate and read the reply. Connect from Settings → Collaboration. Phone stays the remote. LLM inaccuracy disclaimer, link to privacy. No public Add to Slack button. |
| Privacy | `/privacy/` | Data collected, use, retention, access/transfer/delete, contact email (not GitHub-only) |
| Support | `/support/` | Email or form, no extra account, respond within **2 business days** |

Deploy via [deploy.md](deploy.md). Pages live in `site/` (privacy, support, `/slack/`). Redeploy the Fly relay after this lands so www.sideboard.build serves the updated copy.

### 4. Product UX Slack will test

They install as a brand-new customer, including **uninstall**.

- **App Home** (Home tab on): first-run “download Sideboard / name this Mac / DM the bot”, plus support email. Messages tab can stay for DMs. **Done in code** — apply the manifest (home tab + `app_home_opened`) in the Slack dashboard.
- Subscribe to `app_uninstalled` and delete that workspace’s tokens on the Mac + any relay state. **Done in code** — apply `app_uninstalled` in the dashboard, then reinstall.
- Post-OAuth success page: “Open Sideboard → Settings → Collaboration” (not a dead end). Confirm the relay on Settings → Remote. **Done.**
- Meaningful errors when no Mac is online (not “something went wrong”). **Done** — relay posts a setup reply.
- LLM disclaimer on landing + long description; Security & Compliance: models are the user’s local agents (Claude / Codex / OpenCode / Cursor); Slack text is not used to train LLMs.

### 5. Traction gate (blocks submit)

- Installed on **≥ 5 active workspaces** (used in the last 28 days, not sandboxes).
- **≥ 10 weekly active users**.
- Tested install → onboard → DM/@mention → review ping → uninstall on a **non-Brightsy** workspace.

### 6. Review packet

- Video (install, OAuth, setup, DM, uninstall) — 30–90s listing video plus a longer review demo.
- Test notes for reviewers: free Mac app from GitHub Releases; they cannot use our Slack; they must install Sideboard on an Apple Silicon Mac and complete Add via browser. Provide dummy data if needed.
- Staging Slack app (`Sideboard-staging`) for later scope/feature updates.
- Listing: name **Sideboard**; short description **≤ 10 words**; 1600×1000 screenshots of the app **in Slack**; pricing **Free**; language English only if the whole UX is English.

## Prerequisites — status and answers

| # | Requirement | Status | Work | Answer (paste when met) |
|---|-------------|--------|------|-------------------------|
| P1 | Fully functional, publicly installable | Unmet | Public Distribution + Add to Slack from a foreign workspace | |
| P2 | Tested install, onboard, e2e, **uninstall** on a non-dev workspace | Unmet | Script a Brightsy-external workspace run; record video | Date, workspace (not Brightsy), what was tested: |
| P3 | ≥ 5 active workspaces (28 days) | Unmet | Human: get 5 real teams on Listen | Count / date: |
| P4 | ≥ 10 weekly active users | Unmet | Same | Count / date: |
| P5 | Prepared to maintain + support (2 business days) | Pages ready | Support page + monitored inbox — apply after Fly deploy | support@sideboard.build |
| P6 | Meets guidelines (no forbidden scopes / remote-exec / LLM training) | Code ready | Apply dropped scopes in the Slack dashboard; paste **Scope reasons** below. Framing: agents run on the Mac they installed; relay carries message text only; not a downloadable shell script. | See Scope reasons |
| P7 | Not private beta / unfinished | Unmet | Desktop + Slack path used in production by those 5 teams | |

Do not submit while any row is Unmet. Slack returns incomplete apps and **resets the preliminary-review queue**.

## Submission answers (fill as pages and scopes land)

### URLs

- Landing: https://www.sideboard.build/slack/
- Privacy: https://www.sideboard.build/privacy/
- Support: https://www.sideboard.build/support/
- Direct install: not on the public page. Users connect from Settings → Collaboration → Add via browser.

### Scope reasons

Paste into Slack’s “Please add reasons for your app to request this scope.” Say **how Sideboard uses it**, not what the scope means ([data access](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/#data)). Two products: **Listen** (DM / `@Sideboard` → Mac orchestrator) and **MCP** (`slack_list_*`, `slack_read`, `slack_post` on that Mac). Do not include drop-listed scopes in a Marketplace submit.

#### Bot token — paste

**`app_mentions:read`**  
Receive `app_mention` events so `@Sideboard` in a channel the bot is in is forwarded to the orchestrator on the installing user’s Mac, which then replies in that thread.

**`im:history`**  
Receive `message.im` events (and later `conversations.history` on that DM) so a DM to `@Sideboard` is the prompt for the Mac orchestrator, including follow-ups in the same conversation.

**`im:read`**  
Resolve the DM conversation (id, members) when Listen or `slack_post` talks to a person, so we post into the correct D… channel.

**`im:write`**  
Call `conversations.open` when an agent (or the user) asks to DM someone (`slack_post to=@user`) so the bot can start that DM.

**`mpim:history`**  
Receive `message.mpim` events so group DMs that include `@Sideboard` are handled the same way as 1:1 DMs.

**`mpim:read`**  
Resolve the group-DM conversation so replies go back to that MPI, not a new 1:1.

**`channels:read`**  
Call `conversations.list` (public channels) so MCP `slack_list_channels` and `slack_post`/`slack_read` can resolve `#name` to a channel id.

**`groups:read`**  
Same `conversations.list` for private channels the bot has been invited to, so `#private-name` works for list/read/post.

**`channels:history`**  
Call `conversations.history` / `conversations.replies` in public channels the bot is in: MCP `slack_read`, and `slack_replies` watching human replies after the bot posts (e.g. a PR review ping).

**`groups:history`**  
Same history/replies APIs in private channels the bot was added to.

**`chat:write`**  
`chat.postMessage` as `@Sideboard`: Listen replies in the DM or mention thread, and MCP `slack_post` when the user asks the agent to ping someone.

**`chat:write.public`**  
`slack_post` to a public channel the bot is not in (no `/invite`), so an agent can notify `#eng` without joining every public channel at install. We do not auto-join channels.

**`reactions:write`**  
`reactions.add` (`eyes`) on the inbound DM or `@mention` so Slack shows the bot saw the request before the Mac turn finishes.

**`users:read`**  
`users.list` / `users.info` so MCP `slack_list_users` can pick a person for a DM, and so reply-watching shows a display name instead of a user id.

**`users:read.email`**  
`users.lookupByEmail` and email fields on `users.list` so `slack_post to=name@company.com` resolves to a user. We do not send email.

#### User token

Not requested. OAuth omits `user_scope`. Reads and posts use the bot token. A pasted `xoxp-` token is a fallback on this Mac only and is not part of the Marketplace install. Listen still delivers DMs and @mentions only to the Slack user who finished OAuth on that Mac. The relay stores a listen grant for that `authed_user`; the shared bot token is not enough to claim someone else.

### Security & compliance (LLM)

- Models: plugs on the user’s Mac (Claude Code, Codex, OpenCode, Cursor). Sideboard does not host a model.
- Slack message text: relayed to that Mac; **not** used to train LLMs.
- Retention: message text transits `relay.sideboard.build`; tokens live in the Mac vault (`slack-workspaces.json`). See `/privacy/`.
- Tenancy / residency: user’s Mac + Fly relay (sjc). Confirm in privacy page.

### Test account details (for Slack reviewers)

- Service is free; no paid Sideboard account.
- Install: latest Apple Silicon DMG from GitHub Releases.
- After Slack OAuth: open desktop → Settings → Collaboration. Relay connected is on Settings → Remote.
- Uninstall: Slack → App → Remove, then confirm Sideboard drops the workspace.
- We cannot give them a Slack workspace login (Slack forbids that). They install into **their** workspace.

### Contacts

- Developer:
- Support (same as `/support/`): support@sideboard.build; community Slack: https://sideboard-ai.slack.com

## Don’t

- Don’t submit with `search:read` still on the **dashboard** app (repo scopes already dropped; workspaces must reinstall).
- Don’t point the Marketplace landing at GitHub.
- Don’t leave localhost as a production OAuth redirect.
- Don’t promise Marketplace listing until the remote-execution go/no-go is decided.
