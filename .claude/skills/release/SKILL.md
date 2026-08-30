---
name: release
description: >-
  Cut a Sideboard version. “Create a new release” means: signed Mac Electron
  GitHub Release, build CLI/core npms (human publishes), README + marketing
  if needed, commit, push, Fly deploy if site/relay changed. Use for electron
  release, desktop release, pnpm release, or “I’ll publish npms.”
---

# Release

Shared version lives in four `package.json` files (root, `apps/desktop`, `packages/cli`, `packages/core`). Desktop GitHub Releases are signed/notarized on this Mac.

Long pack/notarize/deploy uses [`.claude/skills/long-running/SKILL.md`](../long-running/SKILL.md) (`/long-running`). Do not ask the human to poll.

## What “create a new release” means

These phrases are the **same default** — do not ask which one they meant:

- create a new release
- create an electron release / desktop release
- I’ll publish npms

Do **all** of the following:

1. **Electron** — bump, signed Apple Silicon dmg+zip, notarize, publish GitHub Release (`electron-updater` `latest-mac.yml`).
2. **Build npms** — `pnpm --filter @sideboard-ai/core build` and `pnpm --filter @sideboard-ai/cli build` (and CLI tests). **Do not `npm publish`.** Tell the human the version is ready: `node scripts/publish-npm.js`.
3. **README** — Desktop download URL for `vX.Y.Z`.
4. **Marketing** — update `site/` (and `site/docs/`) when the public story changed (install, Slack, features). Homepage download buttons already point at `/releases/latest`; still refresh copy/screenshots if this cut warrants it.
5. **Changelog** — move `[Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`.
6. **Commit + push** — Release commit, retarget `vX.Y.Z`, open or update the thread PR against **origin**.
7. **Deploy if needed** — if this cut changed `site/` or `apps/slack-relay/`, Fly-deploy the relay+site (below). Skip Fly when those trees are untouched.

Merge the PR only when asked. Do not publish npm unless they explicitly said **publish npm** or **full release including npm**.

## Worktree agents

A worktree turn SIGTERMs a foreground `pnpm release`. Detach the pack, then **wait** (45s slices) until it finishes.

1. Merge `origin/main`. Copy `apps/desktop/.env` from the main checkout if missing (gitignored — do not commit or print it).
2. Land feature work. Write `CHANGELOG.md` `[Unreleased]` for what is shipping. Commit so the tree is clean except version files.
3. Bump versions **only** (skip if `package.json` is already the new version):

   ```bash
   node apps/desktop/scripts/release.js patch mac bump-only
   ```

4. Start the Mac pack **once**:

   ```bash
   node scripts/detached-job.js start mac-release -- node apps/desktop/scripts/release-mac-detached.js --run
   ```

5. **Wait yourself** — loop until `stillRunning` is false. Do not end the turn and ask the user to check.

   ```bash
   node scripts/detached-job.js wait mac-release
   ```

   Same contract as `wait_for_turn`: returns within ~45s with progress. Call wait again while `stillRunning`. After start and after every wait, `present_artifact` `type=log` `artifact_id=mac-release` with `content=delta` only.
6. On `failed`: fix from the log and start the pack **once**. Do not bump again.
7. On `ok`: GitHub Release + DMG are published. Then:

   ```bash
   pnpm --filter @sideboard-ai/core build
   pnpm --filter @sideboard-ai/cli build
   pnpm --filter @sideboard-ai/cli test
   ```

   Do **not** run `node scripts/publish-npm.js` (that publishes). Leave a chat note that they can publish with that command.
8. Point README Desktop download at:

   `https://github.com/mattlevine/sideboard/releases/download/vX.Y.Z/Sideboard-X.Y.Z-arm64.dmg`

9. Update `site/` if the public story changed. Move `[Unreleased]` notes into `## [X.Y.Z] - YYYY-MM-DD`.
10. Commit (`Release vX.Y.Z`). Mention in the message that npm is a separate publish.
11. Push and **retarget** the version tag onto this Release commit. electron-builder’s GitHub publisher creates `vX.Y.Z` on `origin/main` even when the pack ran from a worktree. A plain `git push origin vX.Y.Z` is rejected. Do **not** leave the tag on main — that is the same miss as 0.1.129 / 0.1.130.

    ```bash
    git push -u origin HEAD
    git tag -a "vX.Y.Z" -m "Sideboard vX.Y.Z" -f
    git push origin "refs/tags/vX.Y.Z" --force
    gh release edit "vX.Y.Z" --target "$(git rev-parse HEAD)"
    ```

    Force-push **only** that version tag. Never force-push `main` / `master`.
12. Open or update the thread PR against **origin** (not `upstream`). If the existing PR is already merged, open a new one.
13. **Deploy if needed.** When `site/` or `apps/slack-relay/` changed in this cut:

    ```bash
    node scripts/detached-job.js start fly-deploy -- fly deploy --config apps/slack-relay/fly.toml --dockerfile apps/slack-relay/Dockerfile .
    node scripts/detached-job.js wait fly-deploy
    ```

    From the monorepo root (Docker context is `.`). `present_artifact` `type=log` `artifact_id=fly-deploy` with `delta`. Details: [docs/system/deploy.md](../../../docs/system/deploy.md).

Human at a real terminal: `pnpm release patch mac` is still fine for the Electron half; they still publish npm themselves unless they asked otherwise.

## `@cursor/sdk` in a Sideboard worktree

Every desktop pack in a Sideboard `thread/*` worktree used to die at `stage-cursor-runtime.js` with `Cannot find module '@cursor/sdk'`.

pnpm does not hoist `@cursor/sdk` to the worktree root (only `packages/core` depends on it). The main checkout can look fine if a leftover root hoist exists. Staging must resolve `@cursor/sdk`, `execa`, and `smol-toml` from `packages/core/package.json` — same as `stage-sideboard-mcp.js`. Do not add `@cursor/sdk` to the root package to paper over it. See `docs/system/conventions.md` (Desktop pack in a Sideboard worktree).

Signing/notarization reads `apps/desktop/.env` (`CSC_*`, `APPLE_*`). `GH_TOKEN` comes from that file or `gh auth token`. CI `release.yml` on tags is not a substitute for a local signed Mac build.

Tag `v*` `release-cli` publishes `@sideboard-ai/core` + `@sideboard-ai/cli` via npm trusted publishing (OIDC). Do not gate that step on `if: secrets.NPM_TOKEN` — GitHub rejects the `secrets` context in `if` (`Unrecognized named-value: 'secrets'`). Do not set `NODE_AUTH_TOKEN` or `setup-node` `registry-url` on that job; both skip the OIDC exchange. Trusted publisher on npmjs.com: `mattlevine/sideboard`, workflow `.github/workflows/release.yml`, no Environment name.

## npm publish (only when asked)

```bash
pnpm release patch npm
# or, versions already bumped:
node scripts/publish-npm.js
```

`publish-npm.js --dry-run` builds and pretends to publish — useful to verify, not a substitute for the human’s real publish.

## Full release including npm (only when asked)

```bash
pnpm release          # patch, desktop + npm publish
pnpm release minor
```

Worktree agents still detach the Mac pack after `bump-only`; do not run the combined foreground `pnpm release` from a chat turn. After the pack, they may run `node scripts/publish-npm.js` only if the user asked to publish npm.

## Do not

- Treat “create a new release” as docs-only or as “ask whether they also want Electron.”
- Publish npm on the default release phrase.
- Use the worktree nickname as the PR or release title.
- Push to `upstream` or merge locally into the main checkout.
- Commit `apps/desktop/.env` or `apps/desktop/release/`.
- Force-push `main` / `master`.
- Foreground pack/notarize/deploy in a worktree agent turn, restart a pack because the user asked “status?”, or ask the human to poll a long job.
