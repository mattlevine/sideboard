---
name: release
description: >-
  Cut a Sideboard version: bump the shared semver, changelog, README DMG link,
  signed Mac GitHub Release, optional npm. Use when the user asks for an
  Electron / desktop release, `pnpm release`, or “I’ll publish npms.”
---

# Release

Shared version lives in four `package.json` files (root, `apps/desktop`, `packages/cli`, `packages/core`). Desktop GitHub Releases are signed/notarized on this Mac. npm is often a **separate** publish.

Long pack/notarize uses the general wait tool — [`.claude/skills/long-running/SKILL.md`](../long-running/SKILL.md) (`/long-running`). Do not ask the human to poll.

## Worktree agents: long pack / notarize

A worktree turn SIGTERMs a foreground `pnpm release`. Detach, then **wait** (45s slices) until the pack finishes.

1. Merge `origin/main`. Copy `apps/desktop/.env` from the main checkout if missing (gitignored — do not commit or print it).
2. Write `CHANGELOG.md` `[Unreleased]`. Commit so the tree is clean except version files.
3. Bump versions **only** (skip if `package.json` is already the new version):

   ```bash
   node apps/desktop/scripts/release.js patch mac bump-only
   ```

4. Start the pack **once**:

   ```bash
   node scripts/detached-job.js start mac-release -- node apps/desktop/scripts/release-mac-detached.js --run
   ```

   Or: `node apps/desktop/scripts/release-mac-detached.js` (writes `apps/desktop/release/release.pid`).
5. **Wait yourself** — loop until `stillRunning` is false. Do not end the turn and ask the user to check.

   ```bash
   node scripts/detached-job.js wait mac-release
   # or, if you used release-mac-detached.js start:
   node apps/desktop/scripts/release-mac-detached.js --wait
   ```

   Same contract as `wait_for_turn`: returns within ~45s with progress. Call wait again while `stillRunning`. `--until-done` only if this turn will not be interrupted.
6. On `ok`: GitHub Release + DMG are published. README + changelog + commit + push (below). On `failed`: fix from the log and start **once**.

Human at a real terminal: `pnpm release patch mac` is still fine.

## Desktop-only (“create electron release, I’ll publish npms”)

1. Land feature work first. `CHANGELOG.md` `[Unreleased]` should already describe what is shipping.
2. On a **clean** tree, from repo root — **humans**:

   ```bash
   pnpm release patch mac
   ```

   That bumps all four package versions, builds Apple Silicon dmg+zip, notarizes, publishes to GitHub Releases (`electron-updater` `latest-mac.yml`), then commits the version files and tags `vX.Y.Z`.

   **Worktree agents:** use [Worktree agents](#worktree-agents-long-pack--notarize) + `/long-running`.
3. Do **not** bump again after versions already moved. Continue with `detached-job.js start mac-release` / `release-mac-detached.js`.

## `@cursor/sdk` in a Sideboard worktree

Every desktop pack in a Sideboard `thread/*` worktree used to die at `stage-cursor-runtime.js` with `Cannot find module '@cursor/sdk'`.

pnpm does not hoist `@cursor/sdk` to the worktree root (only `packages/core` depends on it). The main checkout can look fine if a leftover root hoist exists. Staging must resolve `@cursor/sdk`, `execa`, and `smol-toml` from `packages/core/package.json` — same as `stage-sideboard-mcp.js`. Do not add `@cursor/sdk` to the root package to paper over it. See `docs/system/conventions.md` (Desktop pack in a Sideboard worktree).
4. Point README Desktop download at:

   `https://github.com/mattlevine/sideboard/releases/download/vX.Y.Z/Sideboard-X.Y.Z-arm64.dmg`

5. Move `[Unreleased]` notes into `## [X.Y.Z] - YYYY-MM-DD`.
6. Commit those docs (`Release vX.Y.Z` / finish the README link). Note in the message that npm is a separate publish when that is true.
7. Push the branch, then **retarget** the version tag onto this Release commit. electron-builder’s GitHub publisher creates `vX.Y.Z` on `origin/main` (default branch) even when the pack ran from a worktree. A plain `git push origin vX.Y.Z` is rejected. Do **not** leave the tag on main — that is the same miss as 0.1.129 / 0.1.130.

   ```bash
   git push -u origin HEAD
   git tag -a "vX.Y.Z" -m "Sideboard vX.Y.Z" -f
   git push origin "refs/tags/vX.Y.Z" --force
   gh release edit "vX.Y.Z" --target "$(git rev-parse HEAD)"
   ```

   Force-push **only** that version tag. Never force-push `main` / `master`.

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

Worktree agents still detach the Mac pack after `bump-only`; do not run the combined foreground `pnpm release` from a chat turn.

## Do not

- Use the worktree nickname as the PR or release title.
- Push to `upstream` or merge locally into the main checkout.
- Commit `apps/desktop/.env` or `apps/desktop/release/`.
- Force-push `main` / `master`.
- Foreground pack/notarize in a worktree agent turn, restart a pack because the user asked “status?”, or ask the human to poll a long job.
