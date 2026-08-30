---
name: long-running
description: >-
  Detach and wait on any long worktree job (pack, notarize, full test, deploy)
  so a new chat turn does not SIGTERM it, and the human does not have to poll.
  Use when a command may run more than ~30s, or the user mentions wait / status
  / aborted builds.
---

# Long-running jobs

Sideboard ships this method to **every** worktree agent (`/long-running` is a product skill). This repo copy adds Mac-release notes below. A workspace skill with the same name wins over the bundled copy.

A Sideboard or Cursor **worktree turn** SIGTERMs the agent shell (and its process group) when the user sends another message or the turn is interrupted. `block_until_ms: 0` is not enough — the child stays in that group.

Do **not** ask the human to check back. Detach, then **wait** in 45s slices (same idea as MCP `wait_for_turn`) until `stillRunning` is false.

## Tool

Prefer the helper path from the Sideboard playbook (absolute `node "…" start`). In this repo, `scripts/detached-job.js` is the same file.

```bash
# Start (exits in ~1s; job survives this turn)
node scripts/detached-job.js start <id> -- <command> [args...]

# Wait — returns within ~45s even if the job is still going
node scripts/detached-job.js wait <id>

# Block until the process exits (humans / a turn that will not be interrupted)
node scripts/detached-job.js wait <id> --until-done

node scripts/detached-job.js status <id>
node scripts/detached-job.js ui <id> [--title TEXT] [--out FILE]
```

`<id>` is kebab-case (`mac-release`, `core-test`, `fly-deploy`). State is `.sideboard/detached-jobs/<id>/` (gitignored).

Wait JSON:

- `stillRunning: true` → exit 2 → **call wait again**. Progress is in `progress` / `phase`. Do not start a second job. Do not ping the user.
- `ok: true` → exit 0 → continue the rest of the task (README, commit, deploy next step).
- `failed: true` → exit 1 → read `progress`, fix, start **once**.

## Sideboard UI (append-only log)

The side column **is** the live view. Use `present_artifact` **`type=log`** with a stable `artifact_id` (the job id). Each call **appends** — send only `delta` from wait JSON, not the full log and not HTML.

```
present_artifact
  title: <short title>
  type: log
  artifact_id: <id>
  content: <wait.delta>          # new lines only; empty is ok
  status: running | ok | failed  # from wait.status
  phase: <wait.phase>
```

After **start**, present once (`status=running`, empty or first lines). After **every wait**, present the same id with `content=delta`. Do **not** dump the log in chat. Do **not** also fence HTML.

`detached-job.js ui` still writes a snapshot HTML file for debugging. Prefer `type=log`.

If you started via `release-mac-detached.js` (legacy pid/log):

```bash
node scripts/detached-job.js ui --pid-file apps/desktop/release/release.pid --log-file apps/desktop/release/release.log --ok-pattern RELEASE_BUILD_OK --title "Mac pack"
```

Ad-hoc pid/log (legacy or another tool’s files):

```bash
node scripts/detached-job.js wait --pid-file FILE --log-file FILE [--ok-pattern TEXT]
```

## Agent loop

1. `start` once. If JSON says `already-running`, do not start again.
2. Immediately `present_artifact` `type=log` (same `artifact_id`, `status=running`) — the human should see **working** in the side column, not a “check back later” message.
3. Loop `wait` (use `--timeout-ms 15000` for a livelier pane). After each slice, `present_artifact` the **same** id with `content=delta` only.
4. On `ok`, present once more (`status=ok`, last `delta`) and finish the task. On `failed`, fix from the log.

Never tell the user “say status when it’s done.” You wait.

## Mac desktop release

After `bump-only`, either:

```bash
node scripts/detached-job.js start mac-release -- node apps/desktop/scripts/release-mac-detached.js --run
node scripts/detached-job.js wait mac-release
```

or `node apps/desktop/scripts/release-mac-detached.js` then `--wait` (same wait tool, legacy pid/log). Full steps: [`.claude/skills/release/SKILL.md`](../release/SKILL.md).
