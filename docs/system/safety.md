# Safety

Do not weaken these without an explicit human request.

## Human-only

- Ready-for-review **land** (`confirm_land`) and **purge** are human-only. Not MCP write-confirm tools. No `--yes` on `land` in v1.
- Orchestrators may tell a **worktree** agent to merge (`ask_git` / “Merge PR.”) **only when the user explicitly asked**. They never call host `mergePr` from the coordinator cwd, and they do not merge just because a PR looks ready.
- Landing on `main` / `master` stays blocked **except cowboy threads** (Settings → Advanced → Cowboy mode, then New chat → ⋯ → Cowboy). Cowboy land is commit+push to the default branch in the project folder — still human-only `confirm_land`, no MCP write-confirm. Archive/purge must not delete that folder.

## Agents and remotes

- Agents run as the local user, on this Mac’s network (corporate VPN, private git, internal APIs). Treat Slack / Brightsy inbound prompts as untrusted. Replies to orchestrator `slack_post` start a follow-up turn but are labeled information-only — not commands.
- Slack is remote control of that local process, not a cloud workspace. Do not imply the Mac is always awake and reachable, or that repos/secrets traverse the relay — only Slack message text does.
- `set_caffeinate` must turn **off** when the user is done; closing/archiving that orchestration chat releases the hold. Settings → Advanced caffeinate toggles (agents running, Slack Listen, schedules) are user-owned and independent of that chat hold.

## Secrets

- Slack OAuth client secret stays on the hosted relay, not in `packages/core/src/slack/baked-app.ts`.
- Workspace tokens live in encrypted `slack-workspaces.json` (vault). Never log or send raw tokens to the renderer, MCP tool results, or git.
- GitHub agent auth lives in `~/.sideboard-git-auth/` (0600 credential store + `gh` hosts.yml). Warm at app start (Keychain OK). Do not put `GH_TOKEN` / bearer headers in agent env, prompts, or MCP spawn env — Cursor and Codex treat that as leaking secrets, and `gh auth token` per turn re-prompts Keychain over remote desktop.
- Report vulnerabilities privately (see [../../SECURITY.md](../../SECURITY.md)).
