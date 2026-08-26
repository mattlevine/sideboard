# Sideboard

Instructions for agents working **in this git repo**.

Read [docs/system/README.md](docs/system/README.md) before changing code. Then open the docs that match the task:

- [docs/system/architecture.md](docs/system/architecture.md) — packages, Slack/MCP/desktop
- [docs/system/conventions.md](docs/system/conventions.md) — build, test, PRs
- [docs/system/safety.md](docs/system/safety.md) — land/purge, secrets, remote control
- [docs/system/deploy.md](docs/system/deploy.md) — marketing site + Slack relay (Fly)
- [docs/system/slack-marketplace.md](docs/system/slack-marketplace.md) — Public Distribution + Marketplace review

When you make an architecture decision (where something lives, how a host is split, a deploy path, a safety rail), write it into `docs/system/` in the same change — not only in chat or a code comment.

Recurring multi-item work (migration, port, batch fix, fan-out): follow [`.claude/skills/graph-engineering/SKILL.md`](.claude/skills/graph-engineering/SKILL.md) (`/graph-engineering`). Desktop / npm version cuts: [`.claude/skills/release/SKILL.md`](.claude/skills/release/SKILL.md) (`/release`). Any long worktree job (pack, test, deploy): [`.claude/skills/long-running/SKILL.md`](.claude/skills/long-running/SKILL.md) (`/long-running`) — `detached-job.js start` then loop `wait` and refresh `ui` into Sideboard `present_artifact` (do not ask the human to poll). New process guides go in `.claude/skills/<name>/SKILL.md`, not `.sideboard/skills`.

Keep this file and `AGENTS.md` identical.
