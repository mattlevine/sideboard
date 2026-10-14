import { basename } from 'node:path';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import type { Thread } from '../types/thread.js';

/** Fields list_archive needs. Live rows are included so a checkout with a live agent is not a workspace. */
export type ArchiveThread = Pick<
  Thread,
  | 'id'
  | 'title'
  | 'status'
  | 'agent'
  | 'repoPath'
  | 'worktreePath'
  | 'branchName'
  | 'sourceType'
  | 'sourceRef'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<Pick<Thread, 'archivedAt' | 'prUrl' | 'cowboy'>>;

export type ArchiveKind = 'all' | 'workspace' | 'agent';

export type ArchiveAgent = {
  id: string;
  title: string;
  agent: string;
  repo: string;
  branch: string;
  sourceType: string;
  sourceRef: string;
  archivedAt: string;
  prUrl?: string;
  /** Checkout still has a live agent. restore_chat puts this agent back on it. */
  workspaceLive?: boolean;
  /** Checkout has no live agents (kind=agent). restore_workspace brings them all back. */
  workspaceArchived?: boolean;
};

export type ArchiveWorkspace = {
  /** Oldest agent on the checkout. Any nested id also restores the workspace. */
  id: string;
  title: string;
  repo: string;
  branch: string;
  sourceType: string;
  sourceRef: string;
  archivedAt: string;
  prUrl?: string;
  cowboy?: boolean;
  agents: ArchiveAgent[];
};

export type FleetArchiveRow =
  | { kind: 'workspace'; stamp: string; workspace: ArchiveWorkspace }
  | { kind: 'agent'; stamp: string; agent: ArchiveAgent };

export type FleetArchiveView = {
  rows: FleetArchiveRow[];
  shown: number;
  hidden: number;
  total: number;
  query: string;
};

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 250;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stampOf(thread: ArchiveThread): string {
  return thread.archivedAt?.trim() || thread.updatedAt || thread.createdAt || '';
}

function repoLabel(thread: ArchiveThread): string {
  if (isOrchestratorThread(thread)) return 'Orchestration';
  const path = thread.repoPath?.trim() ?? '';
  return (path && basename(path)) || path || 'project';
}

function toAgent(
  thread: ArchiveThread,
  flags?: { workspaceLive?: boolean; workspaceArchived?: boolean },
): ArchiveAgent {
  const prUrl = thread.prUrl?.trim();
  return {
    id: thread.id,
    title: thread.title?.trim() || 'Untitled',
    agent: thread.agent,
    repo: repoLabel(thread),
    branch: thread.branchName ?? '',
    sourceType: thread.sourceType,
    sourceRef: thread.sourceRef,
    archivedAt: stampOf(thread),
    ...(prUrl ? { prUrl } : {}),
    ...(flags?.workspaceLive ? { workspaceLive: true } : {}),
    ...(flags?.workspaceArchived ? { workspaceArchived: true } : {}),
  };
}

function checkoutKey(thread: ArchiveThread): string {
  return thread.worktreePath?.trim() ? normalizeWorktreePath(thread.worktreePath) : '';
}

function liveCheckoutKeys(threads: ArchiveThread[]): Set<string> {
  const keys = new Set<string>();
  for (const thread of threads) {
    if (thread.status === 'archived' || isOrchestratorThread(thread)) continue;
    const key = checkoutKey(thread);
    if (key) keys.add(key);
  }
  return keys;
}

function workspaceFrom(agents: ArchiveThread[]): ArchiveWorkspace {
  const ordered = [...agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const primary = ordered[0]!;
  const rows = ordered.map((thread) => toAgent(thread));
  const archivedAt = rows.reduce(
    (latest, row) => (row.archivedAt > latest ? row.archivedAt : latest),
    '',
  );
  const prUrl = ordered.map((thread) => thread.prUrl?.trim()).find(Boolean);
  return {
    id: primary.id,
    title: primary.title?.trim() || 'Untitled',
    repo: repoLabel(primary),
    branch: primary.branchName ?? '',
    sourceType: primary.sourceType,
    sourceRef: primary.sourceRef,
    archivedAt,
    ...(prUrl ? { prUrl } : {}),
    ...(ordered.some((thread) => thread.cowboy) ? { cowboy: true } : {}),
    agents: rows,
  };
}

function haystack(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function agentHay(agent: ArchiveAgent): string {
  return haystack([
    agent.id,
    agent.title,
    agent.agent,
    agent.repo,
    agent.branch,
    agent.sourceType,
    agent.sourceRef,
    agent.prUrl,
  ]);
}

function workspaceMatches(workspace: ArchiveWorkspace, query: string): boolean {
  if (!query) return true;
  const own = haystack([
    workspace.id,
    workspace.title,
    workspace.repo,
    workspace.branch,
    workspace.sourceType,
    workspace.sourceRef,
    workspace.prUrl,
  ]);
  if (own.includes(query)) return true;
  return workspace.agents.some((agent) => agentHay(agent).includes(query));
}

function clampLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Settings → History for orchestration: archived workspaces (no live agent on
 * that checkout) and archived agents (orchestration chats, or one agent closed
 * while the workspace stayed live).
 */
export function listFleetArchive(
  threads: ArchiveThread[],
  opts?: { query?: string; kind?: ArchiveKind; limit?: number },
): FleetArchiveView {
  const query = opts?.query?.trim().toLowerCase() ?? '';
  const kind = opts?.kind ?? 'all';
  const limit = clampLimit(opts?.limit);
  const liveKeys = liveCheckoutKeys(threads);
  const archived = threads.filter((thread) => thread.status === 'archived');

  const groups = new Map<string, ArchiveThread[]>();
  const loose: ArchiveThread[] = [];
  for (const thread of archived) {
    const key = checkoutKey(thread);
    if (!key || isOrchestratorThread(thread) || liveKeys.has(key)) {
      loose.push(thread);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(thread);
    groups.set(key, group);
  }

  const rows: FleetArchiveRow[] = [];
  if (kind !== 'agent') {
    for (const group of groups.values()) {
      const workspace = workspaceFrom(group);
      if (!workspaceMatches(workspace, query)) continue;
      rows.push({ kind: 'workspace', stamp: workspace.archivedAt, workspace });
    }
  }
  if (kind !== 'workspace') {
    const pool = kind === 'agent' ? archived : loose;
    for (const thread of pool) {
      const key = checkoutKey(thread);
      const orchestration = isOrchestratorThread(thread);
      const agent = toAgent(thread, {
        workspaceLive: Boolean(key) && !orchestration && liveKeys.has(key),
        workspaceArchived: Boolean(key) && !orchestration && !liveKeys.has(key),
      });
      if (query && !agentHay(agent).includes(query)) continue;
      rows.push({ kind: 'agent', stamp: agent.archivedAt, agent });
    }
  }

  rows.sort((a, b) => {
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
    const idA = a.kind === 'workspace' ? a.workspace.id : a.agent.id;
    const idB = b.kind === 'workspace' ? b.workspace.id : b.agent.id;
    return idA.localeCompare(idB);
  });

  const page = rows.slice(0, limit);
  return {
    rows: page,
    shown: page.length,
    hidden: Math.max(0, rows.length - page.length),
    total: rows.length,
    query,
  };
}

/** Archived agents that share this checkout, oldest first. Skips orchestration chats. */
export function archivedAgentsOnCheckout<T extends ArchiveThread>(
  threads: T[],
  worktreePath: string,
): T[] {
  const key = worktreePath.trim() ? normalizeWorktreePath(worktreePath) : '';
  if (!key) return [];
  return threads
    .filter(
      (thread) =>
        thread.status === 'archived' &&
        !isOrchestratorThread(thread) &&
        Boolean(thread.worktreePath?.trim()) &&
        normalizeWorktreePath(thread.worktreePath) === key,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function formatWorkspaceLine(workspace: ArchiveWorkspace): string {
  const bits = [
    workspace.id.slice(0, 8),
    'workspace',
    workspace.repo,
    workspace.branch ? `branch:${workspace.branch}` : '',
    workspace.sourceType && workspace.sourceRef
      ? `${workspace.sourceType}:${workspace.sourceRef}`
      : '',
    `agents:${workspace.agents.length}`,
    workspace.cowboy ? 'cowboy' : '',
    workspace.prUrl ?? '',
    workspace.archivedAt ? `archived:${workspace.archivedAt}` : '',
    oneLine(workspace.title),
  ].filter(Boolean);
  return bits.join('  ');
}

function formatAgentLine(agent: ArchiveAgent): string {
  const bits = [
    agent.id.slice(0, 8),
    'agent',
    agent.repo,
    agent.agent,
    agent.branch ? `branch:${agent.branch}` : '',
    agent.sourceType && agent.sourceRef ? `${agent.sourceType}:${agent.sourceRef}` : '',
    agent.workspaceLive ? 'workspace-live' : '',
    agent.workspaceArchived ? 'workspace-archived' : '',
    agent.prUrl ?? '',
    agent.archivedAt ? `archived:${agent.archivedAt}` : '',
    oneLine(agent.title),
    `sideboard://chat/${agent.id}`,
  ].filter(Boolean);
  return bits.join('  ');
}

/** Token-frugal History list. Ids are prefixes; links use the full chat id. */
export function formatFleetArchive(view: FleetArchiveView): string {
  if (view.total === 0) {
    return view.query ? '(no archive matches)' : '(archive empty)';
  }
  const lines = [
    `${view.shown} shown, ${view.hidden} hidden. restore_workspace <id> brings that checkout and every archived agent back. restore_chat <id> brings one agent back.`,
  ];
  for (const row of view.rows) {
    if (row.kind === 'workspace') {
      lines.push(formatWorkspaceLine(row.workspace));
      for (const agent of row.workspace.agents) {
        lines.push(
          `  ${agent.id.slice(0, 8)}  ${agent.agent}  ${oneLine(agent.title)}  sideboard://chat/${agent.id}`,
        );
      }
      continue;
    }
    lines.push(formatAgentLine(row.agent));
  }
  return lines.join('\n');
}
