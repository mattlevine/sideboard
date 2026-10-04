import {
  claimDesktopHost,
  releaseDesktopHost,
  startAgentRpcServer,
  stopAgentRpcServer,
} from '@sideboard-ai/core';

/**
 * The desktop is the single agent runtime: it claims the host pid file (so
 * MCP/CLI `send_to_chat` never spawns worktree turns in the stdio child) and
 * owns the loopback Agent RPC server that Cursor (worktree and orchestration)
 * native tools call.
 * Listen is fire-and-forget so a bind failure cannot block the window.
 * See docs/system/agent-rpc.md.
 */
export function startDesktopHost(): void {
  claimDesktopHost();
  void startAgentRpcServer().catch((err) => {
    console.warn('Agent RPC skipped:', err instanceof Error ? err.message : err);
  });
}

/**
 * Safe to call from `will-quit` without awaiting: the RPC server removes
 * `agent-runtime.json` synchronously before closing sockets.
 */
export function stopDesktopHost(): void {
  try {
    releaseDesktopHost();
  } catch {
    // ignore
  }
  void stopAgentRpcServer().catch(() => undefined);
}
