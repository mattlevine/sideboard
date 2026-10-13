import { clampBlockReason, writeAgentBlock } from '../orchestrator/agent-block.js';
import { readThread, updateThread } from '../store/thread-store.js';
import {
  askToolPermission,
  setToolPermissionPublisher,
  type ToolPermissionAsk,
} from '../agents/tool-permission.js';
import type { AgentPermissionPrompt } from '../types/agent-block.js';
import { notifyPhonePermission } from '../remote/phone-permission.js';
import type { AgentRpcCallContext, AgentRpcHandler } from './handlers.js';

setToolPermissionPublisher({
  show(item: { threadId: string; prompt: AgentPermissionPrompt }): boolean {
    const thread = readThread(item.threadId);
    if (!thread || thread.status === 'archived') return false;
    writeAgentBlock(item.threadId, {
      source: 'permission',
      reason: clampBlockReason(item.prompt.title),
      at: new Date().toISOString(),
      permission: item.prompt,
    });
    notifyPhonePermission(item.threadId, item.prompt);
    return true;
  },
  clear(threadId: string, id: string): void {
    const thread = readThread(threadId);
    if (
      thread?.agentBlock?.source === 'permission' &&
      thread.agentBlock.permission?.id === id
    ) {
      updateThread(threadId, { agentBlock: null });
      notifyPhonePermission(threadId, null);
    }
  },
});

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function invalidParams(message: string): Error {
  return Object.assign(new Error(message), { rpcCode: -32602 });
}

/** Claude (and any other host) waits here while the composer shows Allow / Deny. */
export const handlePermissionAsk: AgentRpcHandler = async (
  params: unknown,
  _ctx: AgentRpcCallContext,
) => {
  const rec = asRecord(params);
  const threadId = str(rec.threadId).trim();
  const toolName = str(rec.toolName).trim();
  if (!threadId) throw invalidParams('threadId is required');
  if (!toolName) throw invalidParams('toolName is required');
  const input = asRecord(rec.input);
  const ask: ToolPermissionAsk = {
    threadId,
    toolName,
    input: Object.keys(input).length > 0 ? input : undefined,
    blockedPath: str(rec.blockedPath).trim() || undefined,
    title: str(rec.title).trim() || undefined,
    description: str(rec.description).trim() || undefined,
    displayName: str(rec.displayName).trim() || undefined,
    suggestions: rec.suggestions,
    suppressAlwaysAllow: rec.suppressAlwaysAllow === true,
    defaultToNo: rec.defaultToNo === true,
  };
  return askToolPermission(ask);
};
