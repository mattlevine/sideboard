---
name: release
description: >-
  Cut a Sideboard version: bump the shared semver, changelog, README DMG link,
  signed Mac GitHub Release, optional npm. Use when the user asks for an
  Electron / desktop release, `pnpm release`, or “I’ll publish npms.”
---

# Release

Shared version lives in four `package.json` files (root, `apps/desktop`, `packages/cli`, `packages/core`). Desktop GitHub Releases are signed/notarized on this Mac. npm is often a **separate** publish.

## Worktree agents: long pack / notarize

A Sideboard or Cursor **worktree turn** SIGTERMs the agent shell (and its process group) when the user sends another message, asks “status?”, or the turn is interrupted. That is why `pnpm release patch mac` and a foreground `electron-builder` die after a few minutes — or after five seconds.

`block_until_ms: 0` / backgrounding **inside the agent Shell tool is not enough**. The child stays in the turn’s process group and still gets SIGTERM.

**Do this instead:**

1. Merge `origin/main` into this branch. Copy `apps/desktop/.env` from the main checkout if this worktree is missing it (gitignored — do not commit, do not print it).
2. Write `CHANGELOG.md` `[Unreleased]`. Commit so the tree is clean except version files.
3. Bump versions **only** (no pack):

   ```bash
   node apps/desktop/scripts/release.js patch mac bump-only
   ```

   If `package.json` is **already** at the new version from an interrupted release, skip this. Do **not** bump again.
4. Start the pack **detached** (exits in ~1s; job survives this turn):

   ```bash
   node apps/desktop/scripts/release-mac-detached.js
   ```

   Then **end the turn**. Tell the user the pid and that “status?” should check the log — not start a second pack.
5. On **status?** (or any new message while it may still be running):

   ```bash
   node apps/desktop/scripts/release-mac-detached.js --status
   ```

   Read the pid + last log lines. If `(running)`, report that and **stop**. Do not wait in the foreground. Do not spawn another pack.
6. When the log contains `RELEASE_BUILD_OK` and the pid is not running: GitHub Release + DMG are published. Then README + changelog + commit + push (below). If the log shows an error and the pid is dead, fix and run the detached script **once**.

Human at a real terminal (no turn SIGTERM): `pnpm release patch mac` is still fine.

## Desktop-only (“create electron release, I’ll publish npms”)

1. Land feature work first. `CHANGELOG.md` `[Unreleased]` should already describe what is shipping.
2. On a **clean** tree, from repo root — **humans**:

   ```bash
   pnpm release patch mac
   ```

   That bumps all four package versions, builds Apple Silicon dmg+zip, notarizes, publishes to GitHub Releases (`electron-updater` `latest-mac.yml`), then commits the version files and tags `vX.Y.Z`.

   **Worktree agents:** use [Worktree agents: long pack / notarize](#worktree-agents-long-pack--notarize) instead of this one foreground command.
3. Do **not** run the bump script again after versions already moved (it would skip to the next patch). Continue with `node apps/desktop/scripts/release-mac-detached.js` (agents) or `node scripts/stage-*.js` + `electron-builder --mac --publish always` from `apps/desktop` (humans).

## `@cursor/sdk` in a Sideboard worktree

Every desktop pack in a Sideboard `thread/*` worktree used to die at `stage-cursor-runtime.js` with `Cannot find module '@cursor/sdk'`.

pnpm does not hoist `@cursor/sdk` to the worktree root (only `packages/core` depends on it). The main checkout can look fine if a leftover root hoist exists. Staging must resolve `@cursor/sdk`, `execa`, and `smol-toml` from `packages/core/package.json` — same as `stage-sideboard-mcp.js`. Do not add `@cursor/sdk` to the root package to paper over it. See `docs/system/conventions.md` (Desktop pack in a Sideboard worktree).
4. Point README Desktop download at:

   `https://github.com/mattlevine/sideboard/releases/download/vX.Y.Z/Sideboard-X.Y.Z-arm64.dmg`

5. Move `[Unreleased]` notes into `## [X.Y.Z] - YYYY-MM-DD`.
6. Commit those docs (`Release vX.Y.Z` / finish the README link). Note in the message that npm is a separate publish when that is true.
7. Push the branch and the tag:

   ```bash
   git push -u origin HEAD
   git push origin vX.Y.Z
   ```

8. Open or update the thread PR against **origin** (not `upstream`). If the existing PR is already merged, open a new one — do not stack more commits onto a merged PR and call it done. Merge only when asked.

Signing/notarization reads `apps/desktop/.env` (`CSC_*`, `APPLE_*`). `GH_TOKEN` comes from that file or `gh auth token`. CI `release.yml` on tags is not a substitute for a local signed build.

## npm (only when asked)

```bash
pnpm release patch npm
# or, versions already bumped:
node scripts/publish-npm.js
```

Do not publish npm during a desktop-only request.

## Full release (desktop + npm)

```bash
pnpm release          # patch
pnpm release minor
```

Worktree agents still detach the Mac pack (`release-mac-detached.js`) after `bump-only`; do not run the combined foreground `pnpm release` from a chat turn.

## Do not

- Use the worktree nickname as the PR or release title.
- Push to `upstream` or merge locally into the main checkout.
- Commit `apps/desktop/.env` or `apps/desktop/release/`.
- Force-push `main` / `master`.
- Foreground pack/notarize in a worktree agent turn, or restart a pack because the user asked “status?”.
