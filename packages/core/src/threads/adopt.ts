import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolveRepoRoot } from '../git/worktree.js';
import {
  createEmptyThread,
  writeThread,
} from '../store/thread-store.js';
import type {
  AdoptInput,
  AgentKind,
  ConductorWorkspace,
  Thread,
  ThreadMessage,
} from '../types/thread.js';

const CONDUCTOR_APP_SUPPORT = join(
  process.env.HOME ?? '',
  'Library',
  'Application Support',
  'com.conductor.app',
);

const CONDUCTOR_DB = join(CONDUCTOR_APP_SUPPORT, 'conductor.db');
const CURSOR_SDK_STORE = join(CONDUCTOR_APP_SUPPORT, 'cursor-sdk-store');

/** Lazy so packaged MCP can run under system Node (Electron ABI .node would crash). */
function openReadonlySqlite(file: string) {
  const req = createRequire(import.meta.url);
  const Database = req('better-sqlite3') as typeof import('better-sqlite3');
  return new Database(file, { readonly: true, fileMustExist: true });
}

function mapAgentType(raw: string | null | undefined): AgentKind | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes('cursor')) return 'cursor';
  if (v.includes('claude')) return 'claude';
  if (v.includes('codex')) return 'codex';
  if (v.includes('opencode') || v.includes('open-code')) return 'opencode';
  if (v.includes('brightsy')) return 'brightsy';
  return null;
}

/**
 * Conductor persists Cursor SDK agent IDs under cursor-sdk-store/<hash>/agents.ndjson
 * (not in sessions.claude_session_id). Prefer the newest durable agent for a cwd.
 */
export function resolveConductorCursorAgentId(workspacePath: string): string | null {
  if (!workspacePath || !existsSync(CURSOR_SDK_STORE)) return null;
  const normalized = workspacePath.replace(/\/$/, '');
  let best: { agentId: string; updatedAt: number } | null = null;

  let hashes: string[];
  try {
    hashes = readdirSync(CURSOR_SDK_STORE);
  } catch {
    return null;
  }

  for (const hash of hashes) {
    const agentsFile = join(CURSOR_SDK_STORE, hash, 'agents.ndjson');
    if (!existsSync(agentsFile)) continue;
    let text: string;
    try {
      text = readFileSync(agentsFile, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as {
          agentId?: string;
          cwd?: string;
          updatedAt?: number;
        };
        if (!row.agentId || !row.cwd) continue;
        if (row.agentId.startsWith('conductor-one-shot-')) continue;
        const cwd = String(row.cwd).replace(/\/$/, '');
        if (cwd !== normalized) continue;
        const updatedAt = Number(row.updatedAt ?? 0);
        if (!best || updatedAt >= best.updatedAt) {
          best = { agentId: row.agentId, updatedAt };
        }
      } catch {
        // skip bad lines
      }
    }
  }
  return best?.agentId ?? null;
}

export async function adoptThread(input: AdoptInput): Promise<Thread> {
  if (!existsSync(input.worktreePath)) {
    throw new Error(`Worktree not found: ${input.worktreePath}`);
  }
  const repoPath = await resolveRepoRoot(input.worktreePath);
  const { stdout: branch } = await import('../git/run.js').then(({ git }) =>
    git(['rev-parse', '--abbrev-ref', 'HEAD'], input.worktreePath),
  );

  const thread = createEmptyThread({
    title: input.title ?? `Adopted ${branch.trim()}`,
    sourceType: 'adopt',
    sourceRef: input.sourceRef ?? input.worktreePath,
    branchName: branch.trim(),
    worktreePath: input.worktreePath,
    repoPath,
    agent: input.agent,
    sessionId: input.sessionId ?? null,
    messages: input.messages ?? [],
  });
  writeThread(thread);
  const { ensureWorkspace } = await import('../store/workspaces.js');
  await ensureWorkspace(repoPath);
  return thread;
}

export function conductorDbPath(): string {
  return CONDUCTOR_DB;
}

export function listConductorWorkspaces(): ConductorWorkspace[] {
  if (!existsSync(CONDUCTOR_DB)) {
    throw new Error(`Conductor DB not found at ${CONDUCTOR_DB}`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'sideboard-conductor-'));
  const snapshot = join(tmp, 'conductor.db');
  try {
    copyFileSync(CONDUCTOR_DB, snapshot);
    // Best-effort WAL companion copies
    for (const suffix of ['-wal', '-shm']) {
      const src = `${CONDUCTOR_DB}${suffix}`;
      if (existsSync(src)) {
        try {
          copyFileSync(src, `${snapshot}${suffix}`);
        } catch {
          // ignore
        }
      }
    }

    const db = openReadonlySqlite(snapshot);
    try {
      // Defensive schema check
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((t) => t.name));
      if (!names.has('workspaces')) {
        throw new Error('Conductor schema missing workspaces table');
      }

      const rows = db
        .prepare(
          `SELECT
            w.id as id,
            w.workspace_path as workspacePath,
            w.branch as branch,
            COALESCE(w.workspace_name, w.directory_name, w.branch) as workspaceName,
            w.pr_title as prTitle,
            w.pr_description as prDescription,
            w.intended_target_branch as intendedTargetBranch,
            w.notes as notes,
            w.active_session_id as activeSessionId
          FROM workspaces w
          WHERE w.state IS NULL OR w.state != 'archived'
          ORDER BY w.updated_at DESC`,
        )
        .all() as Array<Record<string, unknown>>;

      return rows.map((row) => {
        let claudeSessionId: string | null = null;
        let agentType: AgentKind | null = null;
        let messageCount = 0;
        const activeSessionId = row.activeSessionId as string | null;

        if (names.has('sessions') && activeSessionId) {
          try {
            const session = db
              .prepare(
                `SELECT claude_session_id as claudeSessionId, agent_type as agentType
                 FROM sessions WHERE id = ?`,
              )
              .get(activeSessionId) as
              | { claudeSessionId: string | null; agentType: string | null }
              | undefined;
            claudeSessionId = session?.claudeSessionId ?? null;
            agentType = mapAgentType(session?.agentType) ?? 'claude';
          } catch {
            agentType = 'claude';
          }
        }

        if (names.has('session_messages') && activeSessionId) {
          try {
            const count = db
              .prepare(
                `SELECT COUNT(*) as c FROM session_messages WHERE session_id = ?`,
              )
              .get(activeSessionId) as { c: number };
            messageCount = count.c;
          } catch {
            messageCount = 0;
          }
        }

        const workspacePath = String(row.workspacePath ?? '');
        if (agentType === 'cursor' && !claudeSessionId) {
          claudeSessionId = resolveConductorCursorAgentId(workspacePath);
        }

        return {
          id: String(row.id),
          workspacePath,
          branch: String(row.branch ?? ''),
          workspaceName: String(row.workspaceName ?? row.branch ?? 'workspace'),
          prTitle: (row.prTitle as string) ?? null,
          prDescription: (row.prDescription as string) ?? null,
          intendedTargetBranch: (row.intendedTargetBranch as string) ?? null,
          notes: (row.notes as string) ?? null,
          claudeSessionId,
          agentType,
          messageCount,
        };
      });
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function importConductorWorkspace(workspaceId: string): Thread {
  if (!existsSync(CONDUCTOR_DB)) {
    throw new Error(`Conductor DB not found at ${CONDUCTOR_DB}`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'sideboard-conductor-'));
  const snapshot = join(tmp, 'conductor.db');
  try {
    copyFileSync(CONDUCTOR_DB, snapshot);
    for (const suffix of ['-wal', '-shm']) {
      const src = `${CONDUCTOR_DB}${suffix}`;
      if (existsSync(src)) {
        try {
          copyFileSync(src, `${snapshot}${suffix}`);
        } catch {
          // ignore
        }
      }
    }

    const db = openReadonlySqlite(snapshot);
    try {
      const row = db
        .prepare(
          `SELECT
            w.id as id,
            w.workspace_path as workspacePath,
            w.branch as branch,
            COALESCE(w.workspace_name, w.directory_name, w.branch) as workspaceName,
            w.active_session_id as activeSessionId
          FROM workspaces w WHERE w.id = ?`,
        )
        .get(workspaceId) as Record<string, unknown> | undefined;

      if (!row) throw new Error(`Conductor workspace not found: ${workspaceId}`);

      const worktreePath = String(row.workspacePath);
      if (!existsSync(worktreePath)) {
        throw new Error(`Conductor worktree missing on disk: ${worktreePath}`);
      }

      let sessionId: string | null = null;
      let agent: AgentKind = 'claude';
      const messages: ThreadMessage[] = [];
      const activeSessionId = row.activeSessionId as string | null;

      if (activeSessionId) {
        try {
          const session = db
            .prepare(
              `SELECT claude_session_id as claudeSessionId, agent_type as agentType
               FROM sessions WHERE id = ?`,
            )
            .get(activeSessionId) as
            | { claudeSessionId: string | null; agentType: string | null }
            | undefined;
          sessionId = session?.claudeSessionId ?? null;
          agent = mapAgentType(session?.agentType) ?? 'claude';
        } catch {
          // degrade
        }

        try {
          const rows = db
            .prepare(
              `SELECT role, content, COALESCE(sent_at, created_at) as ts
               FROM session_messages
               WHERE session_id = ?
               ORDER BY COALESCE(sent_at, created_at) ASC`,
            )
            .all(activeSessionId) as Array<{
            role: string;
            content: string;
            ts: string;
          }>;
          for (const m of rows) {
            const role =
              m.role === 'assistant' || m.role === 'agent' ? 'agent' : 'user';
            messages.push({
              role,
              text: m.content ?? '',
              ts: m.ts ?? new Date().toISOString(),
            });
          }
        } catch {
          // degrade to path+branch only
        }
      }

      // Cursor sessions store the resumable agentId in cursor-sdk-store, not claude_session_id.
      if (agent === 'cursor' && !sessionId) {
        sessionId = resolveConductorCursorAgentId(worktreePath);
      }

      let repoPath = worktreePath;
      try {
        repoPath = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: worktreePath,
          encoding: 'utf8',
        }).trim();
      } catch {
        // keep worktreePath
      }

      const thread = createEmptyThread({
        title: String(row.workspaceName ?? row.branch),
        sourceType: 'adopt',
        sourceRef: `conductor:${workspaceId}`,
        branchName: String(row.branch ?? ''),
        worktreePath,
        repoPath,
        agent,
        sessionId,
        messages,
      });
      writeThread(thread);
      return thread;
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function importConductorWorkspaceAsync(
  workspaceId: string,
): Promise<Thread> {
  return importConductorWorkspace(workspaceId);
}
