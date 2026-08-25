# Agent adapters

Sideboard talks to coding agents through a small `AgentAdapter` interface in `@sideboard-ai/core`. Adding an agent is mostly: implement the adapter, register it, extend `AgentKind`.

## Interface

Defined in [`packages/core/src/agents/types.ts`](../packages/core/src/agents/types.ts):

```ts
export interface AgentAdapter {
  kind: AgentKind;
  detect(): Promise<AgentStatus>;
  buildTurn(thread: Thread, input: string | AgentTurnInput): Promise<TurnCommand>;
  parseEvent(line: string): AgentEvent | AgentEvent[] | null;
  resolveSessionId(worktreePath: string, cached: string | null): Promise<string | null>;
  buildAttach(thread: Thread): Promise<AttachCommand>;
  listLinearIssues?(repoPath: string): Promise<IssueInfo[]>; // optional
}
```

| Method | Purpose |
|--------|---------|
| `detect` | Report installed / authenticated for `sideboard detect` |
| `buildTurn` | Spawn command for a non-interactive turn (file, args, cwd, optional stdin/env) |
| `parseEvent` | Map one stdout/stderr line → `AgentEvent`(s) for the board / store. Nested subagent streams set `parentId` to the parent tool id (`task` / `Agent` / `spawn_agent`). |
| `resolveSessionId` | Resume the same native session when possible |
| `buildAttach` | Interactive CLI attach (`sideboard attach`) — same session when possible |
| `listLinearIssues` | Optional Linear MCP bridge for ticket sources |

Reference implementations:

- Claude Code — `packages/core/src/agents/claude.ts`
- Codex — `packages/core/src/agents/codex.ts`
- OpenCode — `packages/core/src/agents/opencode.ts`
- Cursor (SDK) — `packages/core/src/agents/cursor.ts`
- Brightsy (chat-only, optional) — `packages/core/src/agents/brightsy.ts`

## Checklist for a new agent

1. Add the kind to `AgentKind` in `packages/core/src/types/thread.ts`.
2. Create `packages/core/src/agents/<name>.ts` implementing `AgentAdapter`.
3. Register it in `packages/core/src/agents/index.ts` (`adapters` map + exports).
4. Wire any CLI flags / desktop agent picker that enumerate kinds.
5. Add unit tests next to the adapter (`*.test.ts`) for `parseEvent` / detect stubs.
6. Document install + auth in the root README under **Agent CLIs**.

## Guidelines

- Prefer shelling out to the vendor’s official CLI or SDK; don’t scrape private UIs.
- Keep mechanical control on Sideboard’s CLI/MCP; the adapter owns turn spawn + session resume.
- Chat-only agents (no local file edits) are fine — document that limitation like Brightsy.
- Use `permissionMode()` from `types.ts` when the agent supports plan / autonomy modes.
- Map usage to Claude-shaped `TokenUsage` (`inputTokens` uncached; cache extra). OpenAI-shaped CLIs (Codex, Brightsy) use `fromInclusiveInputUsage` — do not add cache or reasoning on top of inclusive totals.
- When the agent CLI reports a USD figure (e.g. Claude `modelUsage.*.costUSD` — not session-cumulative `total_cost_usd` after `--resume` — OpenCode `step_finish` `cost`, Brightsy `usage.cost`), set `TokenUsage.costUsd`. Codex `exec --json` does not include USD on `turn.completed`. Cursor stream usage is tokens-only; billed cost is on `agent.getUsage()` (`UsageCost` cents) and is not mapped yet.
- Nested Task / Agent / `spawn_agent` streams should set `parentId` so the board can nest them under the parent tool. Nested stdout is not the parent answer.

## Out of scope for a first PR

- Auto-publishing the agent to npm
- Desktop polish beyond showing the new kind in the picker
- Cloud remote bridges (built-in Slack — [README](../README.md#slack))
