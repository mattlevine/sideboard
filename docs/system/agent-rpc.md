# Agent RPC

Sideboard’s agent-facing control plane is JSON-RPC 2.0 over a **loopback
WebSocket**, owned by the desktop host (the same process that drains agent
queues and owns Dev-script children).

This is the Orca-shaped split: one runtime process, live RPC, clients
discover it from a metadata file. It is **not** MCP. Injected `sideboard
mcp` stdio remains for Codex and for Claude/OpenCode orchestration. Claude
worktree turns use the Agent SDK runner; OpenCode loads a native plugin.
Cursor worktree and Cursor orchestration attach when the desktop pid is live.

See [`.claude/skills/agent-rpc/SKILL.md`](../../.claude/skills/agent-rpc/SKILL.md)
for the migration rulebook.

## Why not MCP for new agent methods

MCP stdio is a child of the harness. It cannot own Electron children, and
MCP clients kill tool calls around 60s (`wait_for_turn` / `wait_for_job`
return at 45s and the model loops). A held WebSocket call streams
`runtime.progress` notifications to the harness hook while it waits.

## Transports

| Client | Transport | Auth |
|--------|-----------|------|
| Cursor worktree `customTools` | `ws://127.0.0.1:<port>/agent-rpc` | Upgrade query `authToken` plus the same token on every request |
| Cursor orchestration `customTools` | same | same |
| Claude worktree Agent SDK | same (in-process `createSdkMcpServer`) | same |
| OpenCode plugin `tool()` | same (global WebSocket in the plugin) | same |
| Codex / Claude·OpenCode orchestration | Injected MCP stdio (legacy) | Process isolation |
| Future mobile / `serve` | Same protocol, not bound yet | Do not bind `0.0.0.0` in this slice |

Discovery: `{appDataDir}/agent-runtime.json` (mode `0600`), written when
the RPC server starts, removed on stop if this pid still owns the file.
Readers (`agentRpcConnectFromMetadata`) also require the recorded pid to be
alive: a file left by a crashed desktop must put the agent back on injected
MCP, not strip its tools. `AgentRpcServer.close()` unlinks the file
synchronously before closing sockets so Electron `will-quit` need not await.

## Pilot methods

| RPC | Native tool | MCP |
|-----|-------------|-----|
| `runtime.ping` | (not a model tool) | — |
| `ui.presentArtifact` | `present_artifact` (Cursor/OpenCode); `mcp__sideboard_rpc__present_artifact` (Claude SDK) | omitted when `SIDEBOARD_AGENT_RPC_NATIVE=1` |
| `job.wait` | `wait_for_job` / `mcp__sideboard_rpc__wait_for_job` | omitted on that harness MCP |
| `job.stop` | `stop_job` / `mcp__sideboard_rpc__stop_job` | omitted on that harness MCP |
| `turn.wait` | `wait_for_turn` (Cursor orchestration `customTools`) | omitted on that harness MCP (`shouldRegisterMcpWaitForTurn`) |

`job.wait` and `job.stop` require an absolute worktree `cwd` in params
(the desktop's own cwd is `/` when packaged). `job.wait` and `turn.wait`
hold until `stillRunning` is false or `AGENT_RPC_JOB_HOLD_MAX_MS` (120s),
then return `stillRunning: true` and the model calls again. The cap sits
under the Cursor runner's stream-idle guard (`CURSOR_STREAM_IDLE_MS`, 180s);
every `runtime.progress` slice also bumps that guard via
`sideboardCursorRpcTools({ onProgress })` and emits a partial `tool_result`
so the log pane updates during the hold. MCP `wait_for_job` / `wait_for_turn`
stay 45s for unmigrated harnesses.

A harness hook that cannot reach the socket returns `{ ok: false, error }`
as the tool result; it never throws into the runner.

## Where to change what

| Change | Start here |
|--------|------------|
| Protocol / framing / version | `packages/core/src/agent-rpc/protocol.ts` |
| Metadata file | `packages/core/src/agent-rpc/metadata.ts` |
| Method handlers | `packages/core/src/agent-rpc/handlers.ts` |
| WebSocket server | `packages/core/src/agent-rpc/server.ts` |
| Client (harness hooks) | `packages/core/src/agent-rpc/client.ts` |
| Cursor native tools | `packages/core/src/agent-rpc/cursor-tools.ts` |
| Shared execute() | `packages/core/src/agent-rpc/pilot-tools.ts` |
| OpenCode plugin | `packages/core/src/agent-rpc/opencode-hook.ts` |
| Claude runner | `packages/core/src/agents/claude-runner.ts` |
| Desktop listen / quit | `apps/desktop/src/main/desktop-host.ts` |
| Legacy MCP | `packages/core/src/mcp/server.ts` |
