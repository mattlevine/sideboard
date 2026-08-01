import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

const CONDUCTOR_DB = join(
  process.env.HOME ?? '',
  'Library',
  'Application Support',
  'com.conductor.app',
  'conductor.db',
);

function mapAgentType(raw: string | null | undefined): AgentKind | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes('claude')) return 'claude';
  if (v.includes('codex')) return 'codex';
  if (v.includes('opencode') || v.includes('open-code')) return 'opencode';
  return null;
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

    const db = new Database(snapshot, { readonly: true, fileMustExist: true });
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

        return {
          id: String(row.id),
          workspacePath: String(row.workspacePath ?? ''),
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

    const db = new Database(snapshot, { readonly: true, fileMustExist: true });
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
