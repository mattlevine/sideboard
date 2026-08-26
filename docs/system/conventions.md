# Conventions

## Commands

```bash
pnpm install
pnpm --filter @sideboard-ai/core build
pnpm --filter @sideboard-ai/cli build
pnpm --filter @sideboard-ai/core test
pnpm --filter @sideboard-ai/desktop dev
```

`pnpm typecheck` has known debt (Thread test fixtures, electron-vite typings). CI treats typecheck as soft. Prefer green **build + test**.

## Desktop pack in a Sideboard worktree

A Sideboard `thread/*` worktree (this repo checked out by Sideboard, not the main folder) does **not** hoist `@cursor/sdk` to the repo-root `node_modules`. pnpm leaves it under `packages/core/node_modules/@cursor/sdk` only.

`apps/desktop/scripts/stage-cursor-runtime.js` must resolve `@cursor/sdk` / `execa` / `smol-toml` from `packages/core/package.json`. Resolving from the root `package.json` throws `Cannot find module '@cursor/sdk'` on every `pnpm release` / `dist` in a worktree. The main checkout can hide this if a leftover hoist exists at the root. `stage-sideboard-mcp.js` already uses core's `package.json` — keep cursor-runtime the same. Do not “fix” it by installing `@cursor/sdk` on the root package.

## Code

- TypeScript, ESM in core/cli (`"type": "module"`). Desktop main is CJS (electron-vite).
- Colocate tests as `*.test.ts` next to the source.
- Do not put Slack client secrets or `xapp-` tokens in git or the DMG. Relay secrets live on Fly (`SIDEBOARD_SLACK_CLIENT_SECRET`, `SIDEBOARD_SLACK_APP_TOKEN`).
- Do not commit `Untitled/`, `.env`, vault files, or `apps/desktop/release/`.

## Docs

- User-facing behavior (CLI, MCP, Slack URLs, install, process skills): update `README.md`, the matching file under `docs/`, and `site/` (marketing + `/docs/`) when the public story changes.
- Agent-facing repo instructions: update `docs/system/` and keep root `AGENTS.md` / `CLAUDE.md` as pointers (same text in both). Recurring method lives in `.claude/skills/<name>/SKILL.md`.
- Architecture decisions belong in `docs/system/` in the same change (layout, host split, deploy, safety rails) — not only in chat or a code comment.

## Git / PRs

- Focused PRs. Include tests when changing adapters, MCP, or git land paths.
- Do not commit or push unless the user asked.
- Release: follow [`.claude/skills/release/SKILL.md`](../../.claude/skills/release/SKILL.md) (`pnpm release` in the README). Any long worktree command: [`.claude/skills/long-running/SKILL.md`](../../.claude/skills/long-running/SKILL.md) — `node scripts/detached-job.js start <id> -- …` then loop `wait` (45s slices). npm publish uses `--no-git-checks`; desktop GitHub Releases are signed/notarized from `apps/desktop` (**Apple Silicon / arm64 only**). Marketing site + Slack relay: [deploy.md](deploy.md).
