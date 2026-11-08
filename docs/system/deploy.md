# Deploy (marketing site + relay)

The static site in `site/` is not a separate host. It ships inside Sideboard’s own relay (`apps/relay`): phone remote, public site, and Slack collaboration. One deploy updates all three. The Fly app id is `sideboard-slack-relay` because Fly cannot rename apps; that id is not a Slack-only service. Do not create a second app named `sideboard-relay`.

Someone running their own phone relay uses [self-hosted-relay.md](../self-hosted-relay.md) and `apps/relay/Dockerfile.relay`. That image is the relay only. It does not contain `site/`, and the process serves the website only when `SIDEBOARD_SITE_ROOT` is set (this Fly app sets it).

| Host | Serves |
|------|--------|
| https://www.sideboard.build | Marketing site. Canonical host. |
| https://sideboard.build, https://www.sideboard.cloud, https://sideboard.cloud | 301 to www.sideboard.build, except `/oauth/` (Entire’s client document stays on www.sideboard.cloud and does not follow redirects). |
| https://relay.sideboard.build | Phone remote, Slack collaboration, and `/health`. `relay.sideboard.cloud` still reaches this app. |
| https://download.sideboard.build | Desktop artifacts and the auto-update feed. Tigris allows one custom domain, so this is the one with TLS. |
| https://sideboard-downloads.t3.tigrisfiles.io | Working public Tigris host (use this until custom-domain HTTPS works). |

Desktop and npm are a different path (`pnpm release` in the README). The `v*` Release workflow uploads the Mac dmg/zip/`latest-mac.yml` to GitHub Releases, then `publish-downloads` copies them to the Tigris bucket `sideboard-downloads` (`scripts/publish-tigris.sh`). New builds check `https://download.sideboard.build/latest-mac.yml`. Copies already installed keep checking GitHub Releases. Stable alias: `https://sideboard-downloads.t3.tigrisfiles.io/Sideboard-latest-arm64.dmg`. GoDaddy CNAME `download` → `sideboard-downloads.t3.tigrisbucket.io` on both domains. Repo secrets: `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`.

## When

After changing `site/` or `apps/relay/`. A **create a new release** request includes this deploy when those trees changed ([release skill](../../.claude/skills/release/SKILL.md)). Do not ship to Fly on a copy-edit-only turn unless they said so.

## Command

From the **monorepo root** (Docker build context is `.`):

```bash
fly deploy --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile .
```

Needs `flyctl` logged in (`fly auth whoami`). The image is built from the working tree — uncommitted `site/` edits go live. Commit them only if the human asked.

`apps/relay/Dockerfile` copies `site/` to `/app/site`. `fly.toml` sets `SIDEBOARD_SITE_ROOT=/app/site` and the host split above. `http_service.http_options.idle_timeout` is 900s (Fly’s max) so Fly’s proxy does not drop a quiet desktop WebSocket; the desktop still JSON-pings every 20s because home NAT can drop idle TCP without a close.

## Check

- https://www.sideboard.build/ — marketing (apex and the .cloud names 301 here)
- https://www.sideboard.build/docs/ — docs page
- https://www.sideboard.build/robots.txt and https://www.sideboard.build/sitemap.xml
- https://www.sideboard.build/slack/ — Slack collaboration (Settings → Collaboration)
- https://www.sideboard.build/privacy/ — privacy policy
- https://www.sideboard.build/support/ — support
- https://www.sideboard.build/oauth/abletime-client.json — AbleTime CIMD (`redirect_uris` is the HTTPS site callback)
- https://www.sideboard.cloud/oauth/entire-client.json — Entire CIMD. `SIDEBOARD_RELAY_ENTIRE_CLIENT_ID` is that URL. No client secret.
- https://www.sideboard.build/oauth/abletime/callback — AbleTime OAuth return (opens the desktop listener)
- https://relay.sideboard.build/health — JSON; Fly checks this

A brief “not listening on 8080” warning during machine start is normal if Node is still booting; wait for the health check.

## First-time / domains

Comments in `apps/relay/fly.toml`: create the app, set `SIDEBOARD_SLACK_APP_TOKEN` and `SIDEBOARD_SLACK_CLIENT_SECRET`, add certs for sideboard.build, www.sideboard.build, sideboard.cloud, www.sideboard.cloud, relay.sideboard.build, and relay.sideboard.cloud. Phone accounts and pairings are SQLite on the `relay_accounts` volume at `/data` (`initial_size` creates it on deploy; or `fly volumes create relay_accounts -a sideboard-slack-relay -r sjc -s 1`). Set `SIDEBOARD_RELAY_GITHUB_CLIENT_ID` and `SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET`. Cursor sign-in also needs `SIDEBOARD_RELAY_CURSOR_APP_ID` (the Origin app id). Entire sign-in needs `SIDEBOARD_RELAY_ENTIRE_CLIENT_ID` set to `https://www.sideboard.cloud/oauth/entire-client.json` (the client id is that metadata document; leave the secret unset). The redirect for all three is `https://relay.sideboard.build/remote/oauth/callback`. Register that callback on the GitHub OAuth app and the Cursor Origin app. `relay.sideboard.cloud` still reaches this process. Do not put those secrets in git or the image ([safety.md](safety.md)). Keep a single machine: the volume and the live phone sockets belong to that process.

## Don’t

- Don’t `cd apps/relay` and deploy from there — `COPY site` and workspace packages need the repo root as context.
- Don’t treat `relay.sideboard.build` as a place to browse the marketing site.
