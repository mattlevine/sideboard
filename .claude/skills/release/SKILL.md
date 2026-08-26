---
name: release
description: >-
  Cut a Sideboard version: bump the shared semver, changelog, README DMG link,
  signed Mac GitHub Release, optional npm. Use when the user asks for an
  Electron / desktop release, `pnpm release`, or “I’ll publish npms.”
---

# Release

Shared version lives in four `package.json` files (root, `apps/desktop`, `packages/cli`, `packages/core`). Desktop GitHub Releases are signed/notarized on this Mac. npm is often a **separate** publish.

## Desktop-only (“create electron release, I’ll publish npms”)

1. Land feature work first. `CHANGELOG.md` `[Unreleased]` should already describe what is shipping.
2. On a **clean** tree, from repo root:

   ```bash
   pnpm release patch mac
   ```

   That bumps all four package versions, builds Apple Silicon dmg+zip, notarizes, publishes to GitHub Releases (`electron-updater` `latest-mac.yml`), then commits the version files and tags `vX.Y.Z`.
3. Do **not** run the bump script again after versions already moved (it would skip to the next patch). Continue with `node scripts/stage-*.js` + `electron-builder --mac --publish always` from `apps/desktop`.

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

## Do not

- Use the worktree nickname as the PR or release title.
- Push to `upstream` or merge locally into the main checkout.
- Commit `apps/desktop/.env` or `apps/desktop/release/`.
- Force-push `main` / `master`.
