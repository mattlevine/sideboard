# Sideboard

Instructions for agents working **in this git repo**.

Read [docs/system/README.md](docs/system/README.md) before changing code. Then open the docs that match the task:

- [docs/system/glossary.md](docs/system/glossary.md) — project, workspace, chat, agent
- [docs/system/architecture.md](docs/system/architecture.md) — packages, phone remote, MCP, desktop
- [docs/system/agent-rpc.md](docs/system/agent-rpc.md) — agent WebSocket JSON-RPC (Cursor worktree pilot; not an MCP shim)
- [docs/system/agent-orchestration.md](docs/system/agent-orchestration.md) — `taskState`, A2A fit
- [docs/system/conventions.md](docs/system/conventions.md) — build, test, PRs
- [docs/system/safety.md](docs/system/safety.md) — land/purge, secrets, remote control
- [docs/system/deploy.md](docs/system/deploy.md) — marketing site + relay (Fly)
- [docs/system/slack-marketplace.md](docs/system/slack-marketplace.md) — legacy notes. The remote is the phone app, not Slack

When you make an architecture decision (where something lives, how a host is split, a deploy path, a safety rail), write it into `docs/system/` in the same change — not only in chat or a code comment.

Recurring multi-item work (migration, port, batch fix, fan-out): follow [`.claude/skills/graph-engineering/SKILL.md`](.claude/skills/graph-engineering/SKILL.md) (`/graph-engineering`). New Sideboard host methods for agents: [`.claude/skills/agent-rpc/SKILL.md`](.claude/skills/agent-rpc/SKILL.md) (`/agent-rpc`) — WebSocket JSON-RPC owned by desktop, not MCP stdio. Desktop / npm version cuts: [`.claude/skills/release/SKILL.md`](.claude/skills/release/SKILL.md) (`/release`). After merge-from-main or a hung `pnpm install` across worktrees: [`.claude/skills/worktree-install/SKILL.md`](.claude/skills/worktree-install/SKILL.md) (`/worktree-install`) — use the worktree-local store, never a shared `~/.pnpm-store`. Recently merged PRs with un-addressed Cursor Bugbot / cursorbot review comments: [`.claude/skills/bugbot-follow-ups/SKILL.md`](.claude/skills/bugbot-follow-ups/SKILL.md) (`/bugbot-follow-ups`) — collect unresolved threads, triage against `origin/main`, one follow-up PR. Any long worktree job (pack, test, deploy): `/long-running` (Sideboard product skill for every worktree; this repo also has [`.claude/skills/long-running/SKILL.md`](.claude/skills/long-running/SKILL.md) for Mac-release notes) — `detached-job.cjs start` then loop `wait` and `present_artifact` `type=log` with `delta` (do not ask the human to poll). `stop_job` if it hangs or is doing the wrong thing. Connector CLIs: write output to `.context/cli/` (not `.context/attachments/`) and read a slice — never dump raw `--json` / `--expand` into a tool result. New process guides go in `.claude/skills/<name>/SKILL.md`, not `.sideboard/skills`.

**Reading run script logs:** Dev terminal and other run script output are persisted to `~/.sideboard/threads/wt-{hash}-run-{script}.run.log.json`. Agents can call the MCP tool `get_run_log` (ref omitted on worktree turns) to read the tail of any script's output. CLI: `.context/cli/read-dev-log.sh [worktree] [script-name]` for manual access.

Keep this file and `AGENTS.md` identical.
