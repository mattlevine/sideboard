---
name: worktree-install
description: >-
  Reinstall dependencies in a Sideboard worktree after merge-from-main or a
  lockfile change. Use when `pnpm install` hangs, several worktrees install at
  once, or a native build is outside the permitted directory.
---

# Worktree-local package install

Several Sideboard worktrees merging from main and running `pnpm install` at
the same time share `~/.pnpm-store` and `~/.cache/node-gyp`. That lock can
hang, and a Cursor / Codex sandbox only allows writes **inside this worktree**
("permitted directory"). Native rebuilds (`better-sqlite3`, Electron) then
fail or stall if they write to the home cache.

Sideboard already points setup scripts and worktree agent env at
`.context/.sideboard/pkg-cache/` (`npm_config_store_dir`, `npm_config_cache`,
`npm_config_devdir`, `electron_config_cache`). Prefer those. Do not switch
back to a shared home store to "go faster."

## When to reinstall

- `pnpm-lock.yaml` or `package.json` changed after merge / rebase from the
  default branch.
- `node_modules` is missing or a native addon failed to load.

Do **not** `pnpm install` in the main repo checkout.

## How

Detach (`/long-running`). One install per worktree; do not share a store
with sibling worktrees.

```bash
# Env Sideboard already set is enough. If a hang or "permitted directory"
# error remains, pass the dirs explicitly:
pnpm install \
  --store-dir .context/.sideboard/pkg-cache/pnpm-store \
  --cache-dir .context/.sideboard/pkg-cache/pnpm
```

Optional env if the parent stripped them:

```bash
export npm_config_store_dir="$PWD/.context/.sideboard/pkg-cache/pnpm-store"
export npm_config_cache_dir="$PWD/.context/.sideboard/pkg-cache/pnpm"
export npm_config_cache="$PWD/.context/.sideboard/pkg-cache/npm"
export npm_config_devdir="$PWD/.context/.sideboard/pkg-cache/node-gyp"
export electron_config_cache="$PWD/.context/.sideboard/pkg-cache/electron"
```

`stop_job` if there is no progress for a long stretch (store lock or
network). Retry once with the explicit dirs above. Do not delete
`~/.pnpm-store` on the Mac — that races other worktrees.

The cache dir is local scratch (`.context/.sideboard/`). Do not commit it.
