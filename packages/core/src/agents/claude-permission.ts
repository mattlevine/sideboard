import type { AgentRpcConnect } from '../agent-rpc/metadata.js';
import { AgentRpcClient } from '../agent-rpc/client.js';
import { mcpServerIdForPermission, mcpServerPermissionUpdate } from './claude-mcp.js';
import type { ToolPermissionAnswer } from './tool-permission.js';

export type ClaudePermissionOptions = {
  signal?: AbortSignal;
  suggestions?: unknown;
  blockedPath?: string;
  title?: string;
  description?: string;
  displayName?: string;
  suppressAlwaysAllowRule?: boolean;
  defaultToNo?: boolean;
};

export type ClaudePermissionResult =
  | {
      behavior: 'allow';
      updatedPermissions?: unknown[];
      decisionClassification: 'user_temporary' | 'user_permanent';
    }
  | {
      behavior: 'deny';
      message: string;
      decisionClassification: 'user_reject';
    };

function deny(message: string): ClaudePermissionResult {
  return { behavior: 'deny', message, decisionClassification: 'user_reject' };
}

function fromAnswer(raw: unknown): ClaudePermissionResult {
  if (!raw || typeof raw !== 'object') return deny('Sideboard did not return a permission decision.');
  const rec = raw as Partial<ToolPermissionAnswer>;
  if (rec.behavior === 'allow') {
    return {
      behavior: 'allow',
      ...(Array.isArray(rec.updatedPermissions) && rec.updatedPermissions.length > 0
        ? { updatedPermissions: rec.updatedPermissions }
        : {}),
      decisionClassification:
        rec.decisionClassification === 'user_permanent' ? 'user_permanent' : 'user_temporary',
    };
  }
  const message =
    typeof rec.message === 'string' && rec.message.trim()
      ? rec.message.trim()
      : 'The user denied this action.';
  return deny(message);
}

/**
 * Surface a Claude SDK permission ask in Sideboard.
 * Plan mode stays read-only. A missing chat id denies instead of hanging.
 */
export async function claudePermissionResult(input: {
  permissionMode: string;
  threadId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  mcpServer?: string;
  options: ClaudePermissionOptions;
  call?: (method: string, params: unknown) => Promise<unknown>;
  rpc?: AgentRpcConnect;
}): Promise<ClaudePermissionResult> {
  if (input.permissionMode === 'plan') {
    return deny('Plan mode is on, so this action stays blocked.');
  }
  if (input.permissionMode === 'bypassPermissions') {
    const serverId = mcpServerIdForPermission(input.toolName, input.mcpServer);
    if (serverId) {
      return {
        behavior: 'allow',
        updatedPermissions: [mcpServerPermissionUpdate(serverId)],
        decisionClassification: 'user_permanent',
      };
    }
  }
  const threadId = input.threadId.trim();
  if (!threadId) return deny('Sideboard could not tell which chat to ask.');
  if (input.options.signal?.aborted) return deny('The turn was cancelled.');
  const call =
    input.call ??
    (input.rpc
      ? (method: string, params: unknown) => new AgentRpcClient(input.rpc!).call(method, params)
      : null);
  if (!call) return deny('Sideboard has no permission prompt for this turn.');
  try {
    const raw = await call('permission.ask', {
      threadId,
      toolName: input.toolName,
      input: input.toolInput,
      blockedPath: input.options.blockedPath,
      title: input.options.title,
      description: input.options.description,
      displayName: input.options.displayName,
      suggestions: input.options.suggestions,
      ...(input.mcpServer ? { mcpServer: input.mcpServer } : {}),
      suppressAlwaysAllow: input.options.suppressAlwaysAllowRule === true,
      defaultToNo: input.options.defaultToNo === true,
    });
    if (input.options.signal?.aborted) return deny('The turn was cancelled.');
    return fromAnswer(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deny(message || 'Sideboard could not ask for permission.');
  }
}
