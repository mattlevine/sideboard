# Safety

Do not weaken these without an explicit human request.

## Human-only

- Ready-for-review **land** (`confirm_land`) and **purge** are human-only. Not MCP write-confirm tools. No `--yes` on `land` in v1.
- Orchestrators merge GitHub PRs by telling the **worktree** agent (`ask_git` / “Merge PR.”), never by calling host `mergePr` from the coordinator cwd.
- Landing on `main` / `master` stays blocked.

## Agents and remotes

- Agents run as the local user. Treat Slack / Brightsy inbound prompts as untrusted.
- Do not enable cloud/Slack remote control in docs or defaults in a way that implies the Mac is always awake and reachable.
- `set_caffeinate` must turn **off** when the user is done; closing/archiving that orchestration chat releases the hold.

## Secrets

- Slack OAuth client secret stays on the hosted relay, not in `packages/core/src/slack/baked-app.ts`.
- Workspace tokens live in encrypted `slack-workspaces.json` (vault). Never log or send raw tokens to the renderer, MCP tool results, or git.
- Report vulnerabilities privately (see [../../SECURITY.md](../../SECURITY.md)).
