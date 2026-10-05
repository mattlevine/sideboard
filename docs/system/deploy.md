# Deploy (marketing site + relay)

The static site in `site/` is not a separate host. It ships inside Fly app `sideboard-relay` (`apps/relay`). One deploy updates the phone remote, the public site, and legacy Slack.

| Host | Serves |
|------|--------|
| https://www.sideboard.cloud | `site/` (`index.html`, `docs/`) |
| https://sideboard.cloud | 301 → www |
| https://relay.sideboard.cloud | Phone remote, legacy Slack, and `/health` |
| https://download.sideboard.cloud | Intended custom domain for desktop artifacts. CNAME is set; TLS is not issued yet. |
| https://sideboard-downloads.t3.tigrisfiles.io | Working public Tigris host (use this until custom-domain HTTPS works). |

Desktop and npm are a different path (`pnpm release` in the README). The `v*` Release workflow uploads the Mac dmg/zip/`latest-mac.yml` to GitHub Releases, then `publish-downloads` copies them to the Tigris bucket `sideboard-downloads` (`scripts/publish-tigris.sh`). Stable alias: `https://sideboard-downloads.t3.tigrisfiles.io/Sideboard-latest-arm64.dmg`. GoDaddy CNAME `download` → `sideboard-downloads.t3.tigrisbucket.io`. Repo secrets: `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`.

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

- https://www.sideboard.cloud/ — marketing
- https://www.sideboard.cloud/docs/ — docs page
- https://www.sideboard.cloud/slack/ — Slack app landing
- https://www.sideboard.cloud/privacy/ — privacy policy
- https://www.sideboard.cloud/support/ — support
- https://www.sideboard.cloud/oauth/abletime-client.json — AbleTime CIMD (`redirect_uris` is the HTTPS site callback)
- https://www.sideboard.cloud/oauth/abletime/callback — AbleTime OAuth return (opens the desktop listener)
- https://relay.sideboard.cloud/health — JSON; Fly checks this

A brief “not listening on 8080” warning during machine start is normal if Node is still booting; wait for the health check.

## First-time / domains

Comments in `apps/relay/fly.toml`: create the app, set `SIDEBOARD_SLACK_APP_TOKEN` and `SIDEBOARD_SLACK_CLIENT_SECRET`, add certs for the three hosts. Do not put those secrets in git or the image ([safety.md](safety.md)).

## Don’t

- Don’t `cd apps/relay` and deploy from there — `COPY site` and workspace packages need the repo root as context.
- Don’t treat `relay.sideboard.cloud` as a place to browse the marketing site.
