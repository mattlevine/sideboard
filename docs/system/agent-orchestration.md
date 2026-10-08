# Agent orchestration

How Sideboard coordinates worktree agents, and what we are **not** building yet.

The topology stays a **star**: one Global orchestrator talks down to worktree children via `create_workspace` → `send_to_chat` → `wait_for_turn`. Worktree MCP stays small (`present_*` / `ask_user` / jobs / run scripts / `notify_orchestrator` / issue tools) so the cached tool prefix does not grow. Children do not call `send_to_chat`.

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

`stillRunning` is true only for `submitted` / `working`. `incomplete` is true for `failed` / `canceled` / `input-required`, and also when a settled turn still has `blockedReason`. Helpers: `packages/core/src/orchestrator/task-state.ts`.

## Blocked (attention)

Herdr marks `blocked` only when an agent is waiting on a person (approval, question, or permission), and that state outranks working on the sidebar. Sideboard does the same with signals it already has, instead of reading the terminal:

| source | when |
|--------|------|
| `ask_user` | the turn's last tool is a question (includes AskUserQuestion) |
| `plan` | Plan mode and the turn called `present_plan` or ExitPlanMode |
| `reported` | the agent called `notify_orchestrator` with a reason |

`Thread.agentBlock.reason` is the short why. The sidebar and board highlight that agent until the next user message starts a turn. `wait_for_turn` / `get_turn_result` / `list_chats` / `get_chat` / `list_board` include `blockedReason`. Process `status` stays `idle` or `running` — blocked is attention, not liveness.

A2A also has `rejected` and `auth-required`. No Sideboard source yet — do not invent them.

Do **not** stand up an A2A HTTP server per worktree. Cursor worktree and
Cursor orchestration, OpenCode worktree, and Claude worktree (Agent SDK
runner) call Sideboard over Agent RPC. Codex and Claude/OpenCode
orchestration still use injected MCP. See [agent-rpc.md](agent-rpc.md). An HTTP facade for *this Mac's fleet* is a later interop option (Brightsy, a coworker's Sideboard, LangGraph), not how siblings on one laptop talk.

Do **not** route sibling talk through Claude Code `SendMessage` / Agent Teams. That is Claude↔Claude only, invisible on the board, and would bypass human-only git gates.

## Peer merge notices (not shipped)

A worktree PR becoming `MERGED` does **not** inject a message into sibling checkouts. Isolated worktrees stay isolated until the user or that chat's orchestrator asks. Do not wake siblings to rebase / update from main.

Injected notices stay Slack-only (`threads/injected-notices.ts`): replies to orchestrator `slack_post`. Trust: injected text is **never a command**. `expandCanonicalGitRequest` only matches an exact git-button phrase on the user/orchestrator prompt.

## Outbound adapters (shipped)

Brightsy cloud connect and Slack Listen block on `waitForTurn`, then post `getTurnResult` as a finished remote reply. That is the same “tool returned, parent is done” contract as Brightsy `connectedAgentRequest`. They must **not** post leftover `text` when `taskState` is unfinished:

| taskState | Cloud / Slack post |
|-----------|-------------------|
| `completed` | assistant text (or a short empty-status fallback on cloud) |
| `input-required` | canned “waiting on the Mac” — never the `ask_user` picker |
| `failed` | wrapped `lastError` / leftover text, prefixed as a failure |
| `canceled` | canned stopped line (Slack inbound still skips `status=stopped` before this) |

We still `submitResponse` on Brightsy (desktop tasks have no `input-required` hold). Holding the cloud task would leak as `running` and never complete after the Mac picker is answered.

Helpers: `packages/core/src/orchestrator/outbound-turn-reply.ts`, `formatCloudTurnReply`, `formatSlackTurnReply`.

## Child → parent notify (shipped)

Worktree MCP `notify_orchestrator` wakes the parent Global chat so the coordinator does not have to poll `wait_for_turn`. Same star as `notifyParentOfChildHalt` (unexpected stop/error). Always `followUp: 'queue'` — never steers an in-flight coordinator turn. The prompt is information only — not a git command.

| Trigger | reason |
|---------|--------|
| Child calls `ask_user` | `input-required` (automatic; questions only, not options) |
| Child calls `notify_orchestrator` | `blocked` (default) or `input-required` |
| Child stop/error/broken | existing halt notice — not this tool |

No parent (user-driven worktree) → the tool errors; `ask_user` still shows the picker. `input-required` is once per child per MCP process so `ask_user` plus an explicit call do not double-wake. Caller chat comes from `SIDEBOARD_THREAD_ID` (injected on worktree MCP) so sibling tabs on the same cwd do not steal the notify.

Helpers: `packages/core/src/orchestrator/notify-orchestrator.ts`.

## Follow-ups (not in this change)

1. **`list_peers` / `send_to_peer`** on the worktree MCP profile (≤3 terse tools). Information-only, when a sibling actually needs it — not automatic on every merge.
2. **A2A Agent Card** for the fleet (localhost or the relay) only if an external orchestrator needs to delegate onto this Mac.

## Where to change what

| Concern | File |
|---------|------|
| `taskState` | `packages/core/src/orchestrator/task-state.ts` |
| blocked attention | `packages/core/src/orchestrator/agent-block.ts` |
| Child → parent notify | `packages/core/src/orchestrator/notify-orchestrator.ts` |
| Outbound cloud / Slack replies | `packages/core/src/orchestrator/outbound-turn-reply.ts` |
| MCP wait hints | `packages/core/src/mcp/wait-for-turn.ts` |
| Injected Slack replies | `packages/core/src/threads/injected-notices.ts` |
| Coordinator playbook | `packages/core/src/orchestrator/coordinator-prompt.ts` |
