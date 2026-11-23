import { defaultAcpHarness } from '../agents/acp-harness.js';
import { assertOrchestratorCapableAgent } from '../agents/orchestrator-capable.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { Thread, ThreadOptionsPatch } from '../types/thread.js';

/** Apply an agent or ACP-harness change. Mid-chat provider switches throw. */
export function applyThreadAgentPatch(
  thread: Thread,
  patch: ThreadOptionsPatch,
  next: Partial<Thread>,
): void {
  const agent = patch.agent ?? thread.agent;
  const harness =
    agent === 'acp'
      ? patch.acpHarness === 'gemini' || patch.acpHarness === 'copilot'
        ? patch.acpHarness
        : thread.acpHarness === 'gemini' || thread.acpHarness === 'copilot'
          ? thread.acpHarness
          : defaultAcpHarness()
      : null;
  const providerChanged =
    agent !== thread.agent || (agent === 'acp' && harness !== (thread.acpHarness ?? null));
  if (providerChanged) {
    if (thread.messages.length > 0) {
      throw new Error(
        `Cannot switch agent provider mid-chat (${thread.agent} → ${agent}). Start a new chat tab instead.`,
      );
    }
    if (isOrchestratorThread(thread)) assertOrchestratorCapableAgent(agent);
    next.agent = agent;
    if (agent !== 'claude' && patch.model === undefined) next.model = null;
    next.sessionId = null;
  }
  if (agent === 'acp') next.acpHarness = harness;
  else if (thread.acpHarness) next.acpHarness = null;
}
