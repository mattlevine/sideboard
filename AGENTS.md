# Sideboard

Instructions for agents working **in this git repo**.

Read [docs/system/README.md](docs/system/README.md) before changing code. Then open the docs that match the task:

- [docs/system/architecture.md](docs/system/architecture.md) — packages, Slack/MCP/desktop
- [docs/system/conventions.md](docs/system/conventions.md) — build, test, PRs
- [docs/system/safety.md](docs/system/safety.md) — land/purge, secrets, remote control
- [docs/system/deploy.md](docs/system/deploy.md) — marketing site + Slack relay (Fly)
- [docs/system/slack-marketplace.md](docs/system/slack-marketplace.md) — Public Distribution + Marketplace review

When you make an architecture decision (where something lives, how a host is split, a deploy path, a safety rail), write it into `docs/system/` in the same change — not only in chat or a code comment.

Keep this file and `CLAUDE.md` identical.
