/** Sideboard product skill — available in every worktree, not only this repo. */

export const LONG_RUNNING_SKILL_COMMAND = 'long-running';
export const LONG_RUNNING_SKILL_NAME = 'long-running';
export const BUNDLED_LONG_RUNNING_PATH = 'bundled:long-running';

export const LONG_RUNNING_SKILL_DESCRIPTION =
  'Detach and wait on any long worktree job (pack, test, deploy) so a new chat turn does not SIGTERM it, and the human does not have to poll. Use when a command may run more than ~30s, or the user mentions wait / status / aborted builds.';

export const LONG_RUNNING_SKILL_BODY = `# Long-running jobs

A Sideboard or Cursor **worktree turn** SIGTERMs the agent shell (and its process group) when the user sends another message or the turn is interrupted. \`block_until_ms: 0\` is not enough — the child stays in that group.

Do **not** ask the human to check back. Detach, then **wait** in 45s slices (same idea as MCP \`wait_for_turn\`) until \`stillRunning\` is false.

## Tool

Use the helper from the Sideboard playbook — an absolute \`node "…" start\` path injected each turn. If this worktree has \`scripts/detached-job.js\`, that is the same tool.

\`\`\`bash
# Start (exits in ~1s; job survives this turn)
node <detached-job.js> start <id> -- <command> [args...]

# Wait — returns within ~45s even if the job is still going
node <detached-job.js> wait <id>

# Block until the process exits (humans / a turn that will not be interrupted)
node <detached-job.js> wait <id> --until-done

node <detached-job.js> status <id>
\`\`\`

\`<id>\` is kebab-case (\`mac-release\`, \`core-test\`, \`fly-deploy\`). State is \`.context/.sideboard/detached-jobs/<id>/\` (local scratch).

Wait JSON:

- \`stillRunning: true\` → exit 2 → **call wait again**. Progress is in \`progress\` / \`phase\`. Do not start a second job. Do not ping the user.
- \`ok: true\` → exit 0 → continue the rest of the task.
- \`failed: true\` → exit 1 → read \`progress\`, fix, start **once**.

## Sideboard UI (append-only log)

The side column **is** the live view. Use \`present_artifact\` **\`type=log\`** with a stable \`artifact_id\` (the job id). Each call **appends** — send only \`delta\` from wait JSON, not the full log and not HTML.

\`\`\`
present_artifact
  title: <short title>
  type: log
  artifact_id: <id>
  content: <wait.delta>          # new lines only; empty is ok
  status: running | ok | failed  # from wait.status
  phase: <wait.phase>
\`\`\`

After **start**, present once (\`status=running\`, empty or first lines). After **every wait**, present the same id with \`content=delta\`. Do **not** dump the log in chat. Do **not** also fence HTML.

Ad-hoc pid/log (legacy or another tool’s files):

\`\`\`bash
node <detached-job.js> wait --pid-file FILE --log-file FILE [--ok-pattern TEXT]
\`\`\`

## Agent loop

1. \`start\` once. If JSON says \`already-running\`, do not start again.
2. Immediately \`present_artifact\` \`type=log\` (same \`artifact_id\`, \`status=running\`) — the human should see **working** in the side column, not a “check back later” message.
3. Loop \`wait\` (use \`--timeout-ms 15000\` for a livelier pane). After each slice, \`present_artifact\` the same id with \`content=delta\` only.
4. On \`ok\`, present once more (\`status=ok\`, last \`delta\`) and finish the task. On \`failed\`, fix from the log.

Never tell the user “say status when it’s done.” You wait.

## PR checks (only if a goal is given)

Do **not** watch after every push. If the user gave a goal (Greptile 5/5, CI green, until checks pass), wait the same way:

\`\`\`bash
node <detached-job.js> start pr-checks -- gh pr checks --watch
\`\`\`

On miss, fix, commit, push, and watch again until the goal is met or you are blocked. Do not ask the human to poll. Do not merge unless asked.
`;
