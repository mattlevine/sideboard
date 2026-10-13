/**
 * Cancel leftover Cursor runs so a follow-up `send` can proceed.
 * A previous runner can die without cancelling, and a phone/desktop Steer
 * can arrive while Cursor still reports the run as active
 * (`already has active run`, `agent still running`).
 */
import type { importCursorSdk } from './cursor-sdk-resolve.js';

type CursorSdk = NonNullable<Awaited<ReturnType<typeof importCursorSdk>>>;
type AgentApi = CursorSdk['Agent'];
type StoreCtor = CursorSdk['JsonlLocalAgentStore'];

export async function cancelStaleCursorRuns(
  Agent: AgentApi,
  agentId: string,
  opts: { cwd: string; store: InstanceType<StoreCtor>; apiKey?: string },
): Promise<number> {
  let cancelled = 0;
  const listed = await Agent.listRuns(agentId, {
    runtime: 'local',
    cwd: opts.cwd,
    store: opts.store,
    limit: 20,
  });
  for (const run of listed.items) {
    if (run.status !== 'running') continue;
    try {
      await Agent.cancelRun(run.id, {
        runtime: 'local',
        cwd: opts.cwd,
        store: opts.store,
      });
      cancelled += 1;
    } catch {
      /* best-effort */
    }
  }
  if (cancelled > 0 || !opts.apiKey) return cancelled;
  try {
    const cloud = await Agent.listRuns(agentId, {
      runtime: 'cloud',
      apiKey: opts.apiKey,
      limit: 20,
    });
    for (const run of cloud.items) {
      if (run.status !== 'running') continue;
      try {
        await Agent.cancelRun(run.id, {
          runtime: 'cloud',
          agentId,
          apiKey: opts.apiKey,
        });
        cancelled += 1;
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* local-only agents have no cloud runs */
  }
  return cancelled;
}
