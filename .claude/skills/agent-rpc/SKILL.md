---
name: agent-rpc
description: >-
  Sideboard agent control plane. Agents talk JSON-RPC over a loopback
  WebSocket owned by the desktop (or the drain-owner process). Do not add
  new Sideboard capabilities as MCP-only tools. Use when adding a host
  method, a harness hook, or migrating a tool off stdio MCP.
---

# Agent RPC

MCP stdio is the **legacy** agent transport (Claude, Codex, OpenCode, and
orchestration Cursor until those hooks land). The authority for agent host
calls is JSON-RPC on a loopback WebSocket started by the desktop.

This is **not** an MCP shim. Do not spawn `sideboard mcp` to implement a
new agent method. Do not add a stdio JSON-RPC that speaks MCP on one side
and this protocol on the other.

## Judge

A change is done when:

1. `pnpm --filter @sideboard-ai/core test` covers the new method (auth,
   dispatch, and the harness hook if you added one).
2. The method lives in `packages/core/src/agent-rpc/` and is registered on
   the dispatcher — not only in `packages/core/src/mcp/server.ts`.
3. The harness that should use it does **not** expose the same name on
   injected Sideboard MCP (no duplicate tools).

Break the judge once: a test with a bad `authToken` must fail closed.

## Protocol

- JSON-RPC 2.0 text frames over WebSocket (`ws://127.0.0.1:<port>/agent-rpc`).
- Bind loopback only. Every request carries `authToken` (timing-safe compare
  against `agent-runtime.json`, mode `0600`).
- Long waits **hold the call** and send `runtime.progress` notifications.
  The hold cap (`AGENT_RPC_JOB_HOLD_MAX_MS`) must stay under the harness's
  own idle guard (Cursor: `CURSOR_STREAM_IDLE_MS`), and the hook must feed
  progress back into that guard. MCP `wait_*` keeps the 45s cap until that
  harness migrates.
- Methods that touch the worktree (`job.*`) require an absolute `cwd` param.
  The desktop's cwd is not the agent's.
- Desktop (drain owner) writes `{appDataDir}/agent-runtime.json`. Hooks
  attach only when that file names a **live** pid; otherwise the harness
  keeps injected MCP. There is no in-process fallback inside a hook.

## Harness hooks (not MCP)

The model still sees **named tools**. Those tools are native to the harness
and `execute` is a WebSocket client.

| Harness | Hook | Status |
|---------|------|--------|
| Cursor worktree | `@cursor/sdk` `customTools` | Pilot: `present_artifact`, `wait_for_job`, `stop_job` |
| Cursor orchestration | same | Still MCP (fleet tools) |
| Claude | Claude plugin / Agent SDK custom tools | Not started |
| Codex | Custom tools or plugin | Not started |
| OpenCode | Custom tools | Not started |

Do not teach the model to `curl` the socket or Bash-out to a CLI as the
primary path. That is not a hook.

## Fan-out

Migrating the remaining MCP tools is the same shape every time:

1. Add handler + schema on the dispatcher.
2. Expose it on the harness hook (Cursor `customTools` first).
3. Omit that name from injected Sideboard MCP for that harness
   (`SIDEBOARD_AGENT_RPC_NATIVE=1` skips the pilot set; extend the omit
   list as names move).
4. Throw away any MCP-only duplicate. Two names for one method is a failed
   migration.

Pilot three methods (`ui.presentArtifact`, `job.wait`, `job.stop`) before
porting the rest. Next batch: `ask_user`, `present_*`, run-scripts,
`notify_orchestrator`, then Account issue tools, then orchestration fleet
(`wait_for_turn` is the one that most needs a held socket).

## Do not

- Replace Claude/Codex/OpenCode in this skill’s first batches — they still
  inject MCP until their hook exists. Shipping a socket nobody calls is
  fine; ripping MCP from a harness with no hook is not.
- Use vendor MCP (Linear, GitHub, PostHog) as the Sideboard control plane.
- Bind `0.0.0.0` or skip `authToken`.
- Document this as “Sideboard is an MCP server” in new copy. User-facing
  `sideboard mcp` stays for hosts that only speak MCP until they are gone.
