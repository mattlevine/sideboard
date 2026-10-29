/**
 * Host prompt when an agent tool needs permission (a file outside the
 * worktree, a skill under the home directory, or any other ask the CLI
 * would have shown in a terminal).
 *
 * Claude's SDK `canUseTool` waits here. Headless `-p` used to deny those
 * asks because there was no dialog. The desktop composer and the phone
 * show Allow / Deny, and this promise resolves with the tap.
 */
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mcpServerIdForPermission, mcpServerPermissionUpdate } from './claude-mcp.js';
import type { AgentPermissionPrompt } from '../types/agent-block.js';

export type ToolPermissionDecision = 'allow' | 'deny' | 'allow_session';

export type ToolPermissionAsk = {
  threadId: string;
  toolName: string;
  input?: Record<string, unknown>;
  blockedPath?: string;
  title?: string;
  description?: string;
  displayName?: string;
  suggestions?: unknown;
  /** Claude MCP server name, when this ask is for one of its tools. */
  mcpServer?: string;
  suppressAlwaysAllow?: boolean;
  defaultToNo?: boolean;
};

export type ToolPermissionAnswer = {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedPermissions?: unknown[];
  decisionClassification: 'user_temporary' | 'user_permanent' | 'user_reject';
};

type QueueItem = {
  id: string;
  threadId: string;
  prompt: AgentPermissionPrompt;
  suggestions?: unknown;
  /** Set when "allow for this session" should allow the whole MCP server. */
  mcpServerId?: string;
  resolve: (answer: ToolPermissionAnswer) => void;
};

const queues = new Map<string, QueueItem[]>();

export type ToolPermissionPublisher = {
  show(item: { threadId: string; prompt: AgentPermissionPrompt }): boolean;
  clear(threadId: string, id: string): void;
};

let publisher: ToolPermissionPublisher | null = null;

/** Desktop handler installs the composer writer. Tests install a fake. */
export function setToolPermissionPublisher(next: ToolPermissionPublisher | null): void {
  publisher = next;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function pathFromToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path', 'target_file']) {
    const value = clean(input[key]);
    if (value) return value;
  }
  return '';
}

/** Title and path for the composer prompt. */
export function describeToolPermission(ask: ToolPermissionAsk): {
  title: string;
  detail: string;
  path: string;
} {
  const path = clean(ask.blockedPath) || pathFromToolInput(ask.input);
  const action = clean(ask.displayName) || clean(ask.toolName) || 'this action';
  const title =
    clean(ask.title) ||
    (path ? `Allow ${action} on ${path}?` : `Allow ${action}?`);
  return { title, detail: clean(ask.description), path };
}

function denied(message: string): ToolPermissionAnswer {
  return { behavior: 'deny', message, decisionClassification: 'user_reject' };
}

function sessionGrants(item: QueueItem): unknown[] | undefined {
  if (item.mcpServerId) return [mcpServerPermissionUpdate(item.mcpServerId)];
  if (Array.isArray(item.suggestions) && item.suggestions.length > 0) {
    return item.suggestions;
  }
  const dir = directoryGrant(item);
  if (!dir) return undefined;
  return [{ type: 'addDirectories', directories: [dir], destination: 'session' }];
}

function directoryGrantPath(path: string): string {
  if (!path) return '';
  if (path.endsWith('/') || path.endsWith('\\')) return path;
  const dir = dirname(path);
  return dir && dir !== '.' ? dir : path;
}

function directoryGrant(item: QueueItem): string {
  return directoryGrantPath(item.prompt.path ?? '');
}

function toAnswer(item: QueueItem, decision: ToolPermissionDecision): ToolPermissionAnswer {
  if (decision === 'deny') {
    return denied('The user denied this action.');
  }
  if (decision === 'allow_session' && item.prompt.allowSession) {
    return {
      behavior: 'allow',
      updatedPermissions: sessionGrants(item),
      decisionClassification: 'user_permanent',
    };
  }
  return { behavior: 'allow', decisionClassification: 'user_temporary' };
}

function showPrompt(item: QueueItem): boolean {
  if (!publisher) return false;
  return publisher.show({ threadId: item.threadId, prompt: item.prompt });
}

function clearPrompt(threadId: string, id: string): void {
  publisher?.clear(threadId, id);
}

function finish(item: QueueItem, answer: ToolPermissionAnswer): void {
  const q = queues.get(item.threadId) ?? [];
  const idx = q.findIndex((row) => row.id === item.id);
  if (idx >= 0) q.splice(idx, 1);
  if (q.length === 0) queues.delete(item.threadId);
  else queues.set(item.threadId, q);
  item.resolve(answer);
  const next = idx === 0 ? q[0] : undefined;
  if (next) activate(next);
  else if (q.length === 0) clearPrompt(item.threadId, item.id);
}

function activate(item: QueueItem): void {
  if (!publisher) {
    finish(item, denied('Sideboard could not show a permission prompt.'));
    return;
  }
  if (!showPrompt(item)) finish(item, denied('That chat is not on this Mac.'));
}

/** Block until the user allows or denies. One prompt per chat is on screen. */
export function askToolPermission(ask: ToolPermissionAsk): Promise<ToolPermissionAnswer> {
  const threadId = clean(ask.threadId);
  const toolName = clean(ask.toolName);
  if (!threadId || !toolName) return Promise.resolve(denied('Missing chat or tool.'));
  const described = describeToolPermission({ ...ask, threadId, toolName });
  const mcpServerId = mcpServerIdForPermission(toolName, ask.mcpServer) ?? undefined;
  const grantDir = described.path ? directoryGrantPath(described.path) : '';
  const sessionNote =
    grantDir && described.path && grantDir !== described.path
      ? `Allow for this session applies to ${grantDir}, not only this file.`
      : '';
  const prompt: AgentPermissionPrompt = {
    id: randomUUID(),
    title: described.title,
    detail: [described.detail, sessionNote].filter(Boolean).join('\n'),
    path: described.path || undefined,
    // Claude hides "always allow" when the saved rule would be broader than
    // this call. For MCP that broader rule is what we want: the whole server.
    allowSession: mcpServerId ? true : !ask.suppressAlwaysAllow,
    ...(mcpServerId ? { sessionLabel: 'Allow this MCP' } : {}),
    defaultToNo: Boolean(ask.defaultToNo),
  };
  return new Promise((resolve) => {
    const item: QueueItem = {
      id: prompt.id,
      threadId,
      prompt,
      suggestions: ask.suggestions,
      mcpServerId,
      resolve,
    };
    const q = queues.get(threadId) ?? [];
    q.push(item);
    queues.set(threadId, q);
    if (q.length === 1) activate(item);
  });
}

/** Composer click. False when that prompt is already gone. */
export function answerToolPermission(id: string, decision: ToolPermissionDecision): boolean {
  const key = clean(id);
  if (!key) return false;
  for (const q of queues.values()) {
    const item = q.find((row) => row.id === key);
    if (!item) continue;
    finish(item, toAnswer(item, decision));
    return true;
  }
  return false;
}

/** Turn ended or was killed while a prompt was up. */
export function denyPendingToolPermissions(threadId: string): void {
  const q = queues.get(threadId);
  if (!q?.length) return;
  const pending = q.splice(0, q.length);
  queues.delete(threadId);
  const answer = denied('The turn ended before this was allowed.');
  for (const item of pending) item.resolve(answer);
  const last = pending[pending.length - 1];
  if (last) clearPrompt(threadId, last.id);
}

/** Test isolation. */
export function resetToolPermissionsForTests(): void {
  queues.clear();
  publisher = null;
}
