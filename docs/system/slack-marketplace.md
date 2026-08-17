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
| Bot `app_mentions:read` | Yes | Route `@sideboard` |
| Bot `im:*` / `mpim:*` | Yes | DMs to the orchestrator |
| Bot `chat:write`, `chat:write.public`, `reactions:write` | Yes | Replies and review pings |
| Bot `channels:read` / `groups:read` / `users:read` / `team:read` | Yes | MCP list channels/users |
| Bot `channels:history` / `groups:history` | Justify or drop | Needed for `slack_read` in channels the bot is in; write the reason |
| Bot `users:read.email` | Drop unless we can demo it | Not required for Listen |
| User `search:read` | **Drop** | Explicitly unsuitable |
| User `*:history` + `chat:write` | Justify or drop | Only if MCP must act *as the installing user*; otherwise bot token is enough |

Update `docs/slack-app-manifest.yaml` and `packages/core/src/slack/oauth.ts` together. Removing scopes requires every workspace to reinstall.

### 2. Public Distribution

Slack dashboard → **Manage Distribution** → complete their SSL/OAuth checklist → **Activate Public Distribution**.

- OAuth redirect stays `https://relay.sideboard.cloud/slack/callback` (HTTPS).
- Drop `http://127.0.0.1:19847/slack/callback` from the **production** redirect list (local override via `SIDEBOARD_SLACK_OAUTH_REDIRECT` is enough).
- Confirm **Add to Slack** URL works from a workspace that is **not** Brightsy.

### 3. Pages on www.sideboard.cloud

Marketplace landing must be a **public web page for the Slack app**, not GitHub. Privacy + support must be linked from it, no login.

| Page | URL (proposed) | Must include |
|------|----------------|--------------|
| Slack landing | `/slack/` | What it does in Slack, how it works (Mac must be awake), Add to Slack, path after install, LLM inaccuracy disclaimer, link to privacy |
| Privacy | `/privacy/` | Data collected, use, retention, access/transfer/delete, contact email (not GitHub-only) |
| Support | `/support/` | Email or form, no extra account, respond within **2 business days** |

Deploy via [deploy.md](deploy.md). Footer on the marketing homepage should link Privacy + Support.

### 4. Product UX Slack will test

They install as a brand-new customer, including **uninstall**.

- **App Home** (Home tab on): first-run “download Sideboard / name this Mac / DM the bot”, plus support email. Messages tab can stay for DMs.
- Subscribe to `app_uninstalled` and delete that workspace’s tokens on the Mac + any relay state.
- Post-OAuth success page: “Open Sideboard → Settings → Account → Slack” (not a dead end).
- Meaningful errors when no Mac is online (not “something went wrong”).
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
| P5 | Prepared to maintain + support (2 business days) | Unmet | Support page + monitored inbox | Support email: |
| P6 | Meets guidelines (no forbidden scopes / remote-exec / LLM training) | Unmet | Scope cut; go/no-go on inbound commands; privacy copy | Scope justification list: |
| P7 | Not private beta / unfinished | Unmet | Desktop + Slack path used in production by those 5 teams | |

Do not submit while any row is Unmet. Slack returns incomplete apps and **resets the preliminary-review queue**.

## Submission answers (fill as pages and scopes land)

### URLs

- Landing: https://www.sideboard.cloud/slack/
- Privacy: https://www.sideboard.cloud/privacy/
- Support: https://www.sideboard.cloud/support/
- Direct install (302 → `https://slack.com/oauth/v2/authorize?...`): not wired yet — Add to Slack on `/slack/` hits authorize directly
- Add to Slack button: https://www.sideboard.cloud/slack/#install

### Scope reasons

One sentence per remaining scope: **how Sideboard uses it**, not what the scope means. Empty until the scope table in §1 is final.

### Security & compliance (LLM)

- Models: plugs on the user’s Mac (Claude Code, Codex, OpenCode, Cursor). Sideboard does not host a model.
- Slack message text: relayed to that Mac; **not** used to train LLMs.
- Retention: message text transits `relay.sideboard.cloud`; tokens live in the Mac vault (`slack-workspaces.json`). Details go in `/privacy/` once written.
- Tenancy / residency: user’s Mac + Fly relay (sjc). Confirm in privacy page.

### Test account details (for Slack reviewers)

- Service is free; no paid Sideboard account.
- Install: latest Apple Silicon DMG from GitHub Releases.
- After Slack OAuth: open desktop → Settings → Account → Slack workspaces → wait until Relay connected.
- Uninstall: Slack → App → Remove, then confirm Sideboard drops the workspace.
- We cannot give them a Slack workspace login (Slack forbids that). They install into **their** workspace.

### Contacts

- Developer:
- Support (same as `/support/`): support@sideboard.cloud

## Don’t

- Don’t submit with `search:read` still on the app.
- Don’t point the Marketplace landing at GitHub.
- Don’t leave localhost as a production OAuth redirect.
- Don’t promise Marketplace listing until the remote-execution go/no-go is decided.
