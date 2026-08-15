# Deploy (marketing site + Slack relay)

The static site in `site/` is not a separate host. It ships inside Fly app `sideboard-slack-relay` (`apps/slack-relay`). One deploy updates Slack OAuth / Socket Mode **and** the public site.

| Host | Serves |
|------|--------|
| https://www.sideboard.cloud | `site/` (`index.html`, `docs/`) |
| https://sideboard.cloud | 301 → www |
| https://relay.sideboard.cloud | Slack + `/health` only |

Desktop and npm are a different path (`pnpm release` in the README).

## When

After changing `site/` or `apps/slack-relay/`. The human has to ask you to deploy — do not ship to Fly on a copy edit unless they said so.

## Command

From the **monorepo root** (Docker build context is `.`):

```bash
fly deploy --config apps/slack-relay/fly.toml --dockerfile apps/slack-relay/Dockerfile .
```

Needs `flyctl` logged in (`fly auth whoami`). The image is built from the working tree — uncommitted `site/` edits go live. Commit them only if the human asked.

`apps/slack-relay/Dockerfile` copies `site/` to `/app/site`. `fly.toml` sets `SIDEBOARD_SITE_ROOT=/app/site` and the host split above.

## Check

- https://www.sideboard.cloud/ — marketing
- https://www.sideboard.cloud/docs/ — docs page
- https://relay.sideboard.cloud/health — JSON; Fly checks this

A brief “not listening on 8080” warning during machine start is normal if Node is still booting; wait for the health check.

## First-time / domains

Comments in `apps/slack-relay/fly.toml`: create the app, set `SIDEBOARD_SLACK_APP_TOKEN` and `SIDEBOARD_SLACK_CLIENT_SECRET`, add certs for the three hosts. Do not put those secrets in git or the image ([safety.md](safety.md)).

## Don’t

- Don’t `cd apps/slack-relay` and deploy from there — `COPY site` and workspace packages need the repo root as context.
- Don’t treat `relay.sideboard.cloud` as a place to browse the marketing site.
