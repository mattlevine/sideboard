# Agent orchestration

How Sideboard coordinates worktree agents, and what we are **not** building yet.

The topology stays a **star**: one Global orchestrator talks down to worktree children via `create_thread` → `send_to_thread` → `wait_for_turn`. Worktree MCP stays small (`present_*` / `ask_user` / jobs / run scripts / issue tools) so the cached tool prefix does not grow. Children do not call `send_to_thread`.

## Task state (shipped)

`ThreadStatus` (`queued`, `running`, `idle`, `stopped`, `error`, `broken`) is process/liveness. `stillRunning` is a heartbeat. Coordinators used to combine both plus prose hints.

`wait_for_turn` / `get_turn_result` now also return **`taskState`**, using A2A (Agent2Agent) task vocabulary:

| taskState | Sideboard meaning |
|-----------|-------------------|
| `submitted` | queued, waiting for a concurrency slot — not started |
| `working` | the agent is running this turn |
| `input-required` | the turn ended on `ask_user`; wait for the human in that chat |
| `completed` | the turn ended with an answer |
| `failed` | runner/agent error, or worktree missing (`broken`) |
| `canceled` | force-stopped before finishing |

`stillRunning` is true only for `submitted` / `working`. `incomplete` is true for `failed` / `canceled` / `input-required`. Helpers: `packages/core/src/orchestrator/task-state.ts`.

A2A also has `rejected` and `auth-required`. No Sideboard source yet — do not invent them.

Do **not** stand up an A2A HTTP server per worktree. The agents Sideboard wraps (Claude CLI, Codex, OpenCode, Cursor SDK) speak MCP tools, not A2A. An HTTP facade for *this Mac's fleet* is a later interop option (Brightsy, a coworker's Sideboard, LangGraph), not how siblings on one laptop talk.

Do **not** route sibling talk through Claude Code `SendMessage` / Agent Teams. That is Claude↔Claude only, invisible on the board, and would bypass human-only git gates.

## Fleet notices (shipped)

When a worktree PR first becomes `MERGED`, sibling live checkouts of the **same repo** (one thread per worktree, not the merged checkout, not orchestrators, not archived/broken) get an information-only agent message:

`Sideboard fleet notice: sibling … merged — origin default branch moved.`

plus changed files and overlap with that sibling's dirty files. Delivery reuses the Slack-reply pattern (`threads/injected-notices.ts`): append, then `Orchestrator.send(..., { followUp: 'queue' })` so an in-flight turn is not steered. CLI `--resume` does not see appended messages, so the next turn re-includes pending notices in the prompt.

Trust: peer/Slack injected text is **never a command**. `expandCanonicalGitRequest` only matches an exact git-button phrase on the user/orchestrator prompt — a notice must not be that phrase, and must not say `Merge PR.`

Hook: `persistPrMetaAndMaybeArchive` notifies **before** auto-archive so `git diff --name-only` still runs in the merged worktree.

## Follow-ups (not in this change)

1. **`list_peers` / `send_to_peer`** on the worktree MCP profile (≤3 terse tools). Same information-only delivery. Default visibility: siblings under one `parentThreadId`.
2. **`notify_orchestrator`** so a child can bubble `input-required` / blocked without the parent polling.
3. **A2A Agent Card** for the fleet (localhost or the Slack relay) only if an external orchestrator needs to delegate onto this Mac.

Same-file collision notices (dirty overlap without a merge) can reuse `peer-notices.ts` later; they are not wired yet.

## Where to change what

| Concern | File |
|---------|------|
| `taskState` | `packages/core/src/orchestrator/task-state.ts` |
| MCP wait hints | `packages/core/src/mcp/wait-for-turn.ts` |
| Injected Slack + fleet messages | `packages/core/src/threads/injected-notices.ts` |
| Merge → sibling notice | `packages/core/src/orchestrator/peer-notices.ts` |
| Coordinator playbook | `packages/core/src/orchestrator/coordinator-prompt.ts` |
