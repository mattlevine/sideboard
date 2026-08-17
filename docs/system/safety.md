# Safety

Do not weaken these without an explicit human request.

## Human-only

- Ready-for-review **land** (`confirm_land`) and **purge** are human-only. Not MCP write-confirm tools. No `--yes` on `land` in v1.
- Orchestrators may tell a **worktree** agent to merge (`ask_git` / “Merge PR.”) **only when the user explicitly asked**. They never call host `mergePr` from the coordinator cwd, and they do not merge just because a PR looks ready.
- Landing on `main` / `master` stays blocked.

## Agents and remotes

- Agents run as the local user, on this Mac’s network (corporate VPN, private git, internal APIs). Treat Slack / Brightsy inbound prompts as untrusted.
- Slack is remote control of that local process, not a cloud workspace. Do not imply the Mac is always awake and reachable, or that repos/secrets traverse the relay — only Slack message text does.
- `set_caffeinate` must turn **off** when the user is done; closing/archiving that orchestration chat releases the hold.

## Secrets

- Slack OAuth client secret stays on the hosted relay, not in `packages/core/src/slack/baked-app.ts`.
- Workspace tokens live in encrypted `slack-workspaces.json` (vault). Never log or send raw tokens to the renderer, MCP tool results, or git.
- Report vulnerabilities privately (see [../../SECURITY.md](../../SECURITY.md)).
