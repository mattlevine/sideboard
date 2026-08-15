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

## Code

- TypeScript, ESM in core/cli (`"type": "module"`). Desktop main is CJS (electron-vite).
- Colocate tests as `*.test.ts` next to the source.
- Do not put Slack client secrets or `xapp-` tokens in git or the DMG. Relay secrets live on Fly (`SIDEBOARD_SLACK_CLIENT_SECRET`, `SIDEBOARD_SLACK_APP_TOKEN`).
- Do not commit `Untitled/`, `.env`, vault files, or `apps/desktop/release/`.

## Docs

- User-facing behavior (CLI, MCP, Slack URLs, install): update `README.md` and the matching file under `docs/`.
- Agent-facing repo instructions: update `docs/system/` and keep root `AGENTS.md` / `CLAUDE.md` as pointers (same text in both).
- Architecture decisions belong in `docs/system/` in the same change (layout, host split, deploy, safety rails) — not only in chat or a code comment.

## Git / PRs

- Focused PRs. Include tests when changing adapters, MCP, or git land paths.
- Do not commit or push unless the user asked.
- Release: `pnpm release` (see README). npm publish uses `--no-git-checks`; desktop GitHub Releases are signed/notarized from `apps/desktop` (**Apple Silicon / arm64 only**). Marketing site + Slack relay: [deploy.md](deploy.md).
