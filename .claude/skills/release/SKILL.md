---
name: release
description: >-
  Cut a Sideboard version. Default: bump, README/changelog, commit, merge,
  then push/retarget the `v*` tag so `.github/workflows/release.yml` publishes
  npm (OIDC) and the signed Mac desktop. No workflow_dispatch. Do not pack
  Electron in a worktree turn. Use for electron release, desktop release,
  pnpm release, or “I’ll publish npms.”
---

# Release

Shared version lives in four `package.json` files (root, `apps/desktop`, `packages/cli`, `packages/core`).

**The Release Action runs when a `v*` tag is pushed to origin.** That is the default path. Do not pack Electron in a worktree turn. A human at a real terminal may still run `pnpm release patch mac` locally.

Long waits (Actions watch, Fly deploy, optional local pack) use [`.claude/skills/long-running/SKILL.md`](../long-running/SKILL.md) (`/long-running`). Do not ask the human to poll.

## What “create a new release” means

These phrases are the **same default** — do not ask which one they meant:

- create a new release
- create an electron release / desktop release
- I’ll publish npms

Do **all** of the following:

1. **Electron** — bump, then let `.github/workflows/release.yml` pack/sign/publish the Apple Silicon dmg+zip (`electron-updater` `latest-mac.yml`) when the `v*` tag is pushed.
2. **npm** — the same tag job publishes `@sideboard-ai/core` + `@sideboard-ai/cli` via OIDC. It skips versions already on npm. Do not run `node scripts/publish-npm.js` from the worktree unless they explicitly asked.
3. **README** — Desktop download URL for `vX.Y.Z`.
4. **Marketing** — update `site/` (and `site/docs/`) when the public story changed (install, Slack, features). Homepage download buttons already point at `/releases/latest`; still refresh copy/screenshots if this cut warrants it.
5. **Changelog** — move `[Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`.
6. **Commit + push** — Release commit, retarget `vX.Y.Z`, open or update the thread PR against **origin**.
7. **Deploy if needed** — if this cut changed `site/` or `apps/slack-relay/`, Fly-deploy the relay+site (below). Skip Fly when those trees are untouched.

Merge the PR only when asked. Do not publish npm unless they explicitly said **publish npm** or **full release including npm**.

## Worktree agents

The Action starts when the **`v*` tag is pushed** (or moved) to origin. Do not start a local Mac pack. Do not run foreground `pnpm release`.

1. Merge `origin/main`.
2. Land feature work. Write `CHANGELOG.md` `[Unreleased]` for what is shipping.
3. Bump versions **only** (skip if `package.json` is already the new version):

   ```bash
   node apps/desktop/scripts/release.js patch mac bump-only
   ```

   Signing env (`apps/desktop/.env`) is not required for this path.
4. Point README Desktop download at:

   `https://github.com/mattlevine/sideboard/releases/download/vX.Y.Z/Sideboard-X.Y.Z-arm64.dmg`

5. Update `site/` if the public story changed. Move `[Unreleased]` notes into `## [X.Y.Z] - YYYY-MM-DD`.
6. Commit (`Release vX.Y.Z`).
7. Open or update the thread PR against **origin**. Merge when asked (or when this turn is a Merge PR / “commit push and merge”).
8. After the Release commit is on `origin/main`, **retarget** the version tag onto that commit. A tag left on an older SHA packs the old tree. Force-push **only** that version tag — never `main` / `master`.

   ```bash
   git fetch origin
   git tag -a "vX.Y.Z" -m "Sideboard vX.Y.Z" origin/main -f
   git push origin "refs/tags/vX.Y.Z" --force
   ```

   That push is what starts `.github/workflows/release.yml`. There is no **Run workflow** button.
9. **Watch Actions yourself** (`/long-running`). Do not ask the human to poll.

   ```bash
   RUN=$(gh run list --workflow=release.yml --limit 1 --json databaseId,headBranch --jq '.[0].databaseId')
   node scripts/detached-job.js start gha-release -- gh run watch "$RUN" --exit-status
   ```

   `present_artifact` `type=log` `artifact_id=gha-release` with `content=delta` only. CI on the same commit title is **not** a second Release — only the tag workflow publishes.
10. On desktop job **heap OOM** or **`SecKeychainUnlock` / `set-key-partition-list`**: fix `release.yml` (heap → `NODE_OPTIONS`; keychain → import-cert step, do not pass `CSC_LINK` into electron-builder), land that on main, retarget the **same** `vX.Y.Z` (do not bump). `publish-npm.js` skips versions already on npm. This is not the Apple Developer agreement prompt (that fails at notarization).
11. **Deploy if needed.** When `site/` or `apps/slack-relay/` changed in this cut:

    ```bash
    node scripts/detached-job.js start fly-deploy -- fly deploy --config apps/slack-relay/fly.toml --dockerfile apps/slack-relay/Dockerfile .
    node scripts/detached-job.js wait fly-deploy
    ```

    From the monorepo root (Docker context is `.`). `present_artifact` `type=log` `artifact_id=fly-deploy` with `delta`. Details: [docs/system/deploy.md](../../../docs/system/deploy.md).

Human at a real terminal: `pnpm release patch mac` is still fine for the Electron half; they still publish npm themselves unless they asked otherwise.

## `@cursor/sdk` in a Sideboard worktree

Every desktop pack in a Sideboard `thread/*` worktree used to die at `stage-cursor-runtime.js` with `Cannot find module '@cursor/sdk'`.

pnpm does not hoist `@cursor/sdk` to the worktree root (only `packages/core` depends on it). The main checkout can look fine if a leftover root hoist exists. Staging must resolve `@cursor/sdk`, `execa`, and `smol-toml` from `packages/core/package.json` — same as `stage-sideboard-mcp.js`. Do not add `@cursor/sdk` to the root package to paper over it. See `docs/system/conventions.md` (Desktop pack in a Sideboard worktree).

Signing/notarization for the **local** pack reads `apps/desktop/.env` (`CSC_*`, `APPLE_*`). `GH_TOKEN` comes from that file or `gh auth token`.

## GitHub Actions (`release.yml`)

There is no **Run workflow** / `workflow_dispatch`. The workflow runs only when a **`v*` tag is pushed** to **origin** (`mattlevine/sideboard`):

```yaml
on:
  push:
    tags:
      - 'v*'
```

That is why step 8 retargets `vX.Y.Z` onto the Release commit on `origin/main`. A tag that still points at an old SHA will run Actions against that old tree.

Two jobs, both on the same tag push:

| Job | Runner | What it does |
|---|---|---|
| `release-cli` | `ubuntu-latest` | Builds/tests, then publishes `@sideboard-ai/core` + `@sideboard-ai/cli` via **npm trusted publishing (OIDC)**. |
| `release-desktop-mac` | `macos-latest` | Import Developer ID into a runner keychain, Vite + stage Node/MCP/Cursor runtime, then `electron-builder --mac --publish always` without `CSC_LINK` (GitHub Release + `latest-mac.yml`). |

`release-cli` uses `permissions: id-token: write`. Do **not** gate it on `if: secrets.NPM_TOKEN` — GitHub rejects the `secrets` context in `if` (`Unrecognized named-value: 'secrets'`). Do **not** set `NODE_AUTH_TOKEN` or `setup-node` `registry-url` on that job; both skip the OIDC exchange. Trusted publisher on npmjs.com: `mattlevine/sideboard`, workflow file `.github/workflows/release.yml`, **no Environment name**. The `NPM_TOKEN` repo secret is unused for this job.

`release-desktop-mac` signs/notarizes only when repo secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set. The job imports the `.p12` into a runner keychain and **unsets** `CSC_LINK` before `electron-builder` (electron-builder#10066: `set-key-partition-list` uses the p12 password, which macOS 26.6 rejects). If `MAC_CSC_LINK` is empty, it still packs and uploads with `-c.mac.identity=null` (unsigned; no auto-update). The job sets `NODE_OPTIONS=--max-old-space-size=8192` so `electron-vite` does not OOM on the hosted runner.

Do **not** treat a `SecKeychainUnlock: The user name or passphrase you entered is not correct` failure as an Apple Developer Program agreement problem. Agreement / paid-account lapses fail later in **notarization** (`notarytool` / “you must first sign the relevant contracts”). The keychain error is local to the runner and is the #10066 path — keep the import-then-auto-discover workaround until a published `electron-builder` includes the fix.

CI (`ci.yml` on PR / `main` push) only tests. GitHub titles those runs with the commit message, so they look like extra Release jobs — they are not.

To fire Actions on current `origin/main` without a new local pack (human asked to run the workflow):

```bash
git fetch origin
git tag -a "vX.Y.Z" -m "Sideboard vX.Y.Z" -f
git push origin "refs/tags/vX.Y.Z" --force
```

Use the version in `package.json`. Force-push **only** that version tag. Watch **Actions → Release**.

Pushing `.github/workflows/*.yml` needs the GitHub `workflow` OAuth scope (`gh auth refresh -s workflow`). A token without it is rejected (`refusing to allow an OAuth App to create or update workflow`).

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

Worktree agents push the `v*` tag and watch Actions. Do not run the combined foreground `pnpm release` from a chat turn.

## Do not

- Treat “create a new release” as docs-only or as “ask whether they also want Electron.”
- Publish npm on the default release phrase.
- Use the worktree nickname as the PR or release title.
- Push to `upstream` or merge locally into the main checkout.
- Commit `apps/desktop/.env` or `apps/desktop/release/`.
- Force-push `main` / `master`.
- Pack Electron locally in a worktree turn, or restart a job because the user asked “status?”.
- Expect Actions → Release to have a **Run workflow** button. Trigger it by pushing a `v*` tag.
- Ask the human to poll a long job.
