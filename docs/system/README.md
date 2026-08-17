# Sideboard system docs

Canonical instructions for agents working **on this repository** (not for Sideboard’s in-app orchestrator). Read these before changing code.

| Doc | When |
|-----|------|
| [architecture.md](architecture.md) | Layout, packages, how Slack/MCP/desktop fit, process skills |
| [conventions.md](conventions.md) | Build, test, docs, release |
| [safety.md](safety.md) | Human-only land/purge, user-gated merge, secrets, remote control |
| [deploy.md](deploy.md) | Marketing site + Slack relay on Fly |
| [slack-marketplace.md](slack-marketplace.md) | Public Distribution + Slack Marketplace prerequisites |

Recurring multi-item / fan-out work: follow [`.claude/skills/graph-engineering/SKILL.md`](../../.claude/skills/graph-engineering/SKILL.md) (`/graph-engineering`). New process guides go in `.claude/skills/<name>/SKILL.md`, not `.sideboard/skills`.

Product / user docs (not required for every change):

- [../agent-adapters.md](../agent-adapters.md) — adding a coding agent
- [../remote-integrations.md](../remote-integrations.md) — Slack listen / destinations
- [../COMPARE.md](../COMPARE.md) — vs Conductor / other boards
- [../../README.md](../../README.md) — product overview, [process skills](../../README.md#process-skills)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — PR checklist
