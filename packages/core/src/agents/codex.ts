import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo } from '../types/thread.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

function codexConfigHasNetworkAccess(): boolean {
  const candidates = [
    join(homedir(), '.codex', 'config.toml'),
    join(homedir(), '.config', 'codex', 'config.toml'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (/network_access\s*=\s*true/.test(text)) return true;
  }
  return false;
}

export const codexAdapter: AgentAdapter = {
  kind: 'codex',

  async detect(): Promise<AgentStatus> {
    const which = await run('which', ['codex'], { reject: false });
    if (which.exitCode !== 0) {
      return {
        agent: 'codex',
        installed: false,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason: 'codex CLI not found on PATH',
      };
    }

    const auth = await run('codex', ['login', 'status'], { reject: false });
    const authenticated = auth.exitCode === 0;

    const mcp = await run('codex', ['mcp', 'list', '--json'], { reject: false });
    const linearMcp = /linear/i.test(mcp.stdout + mcp.stderr);

    const warnings: string[] = [];
    if (!codexConfigHasNetworkAccess()) {
      warnings.push(
        'Codex workspace-write blocks network by default — set [sandbox_workspace_write] network_access = true in ~/.codex/config.toml if agents need npm install etc.',
      );
    }

    return {
      agent: 'codex',
      installed: true,
      authenticated,
      linearMcp,
      warnings,
      reason: authenticated ? undefined : 'codex login status failed — run `codex login`',
    };
  },

  async buildTurn(thread, prompt): Promise<TurnCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (sessionId) {
      // Never use --last — it's global and wrong under concurrency.
      return {
        file: 'codex',
        args: [
          'exec',
          'resume',
          sessionId,
          prompt,
          '--cd',
          thread.worktreePath,
          '--json',
          '--sandbox',
          'workspace-write',
          '--ask-for-approval',
          'never',
        ],
        cwd: thread.worktreePath,
      };
    }
    return {
      file: 'codex',
      args: [
        'exec',
        prompt,
        '--cd',
        thread.worktreePath,
        '--json',
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
      ],
      cwd: thread.worktreePath,
    };
  },

  parseEvent(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const sid =
        (typeof obj.session_id === 'string' && obj.session_id) ||
        (typeof obj.thread_id === 'string' && obj.thread_id) ||
        (typeof (obj as { session?: { id?: string } }).session?.id === 'string' &&
          (obj as { session: { id: string } }).session.id);
      if (sid) return { type: 'session_id', data: sid };

      if (typeof obj.item === 'object' && obj.item !== null) {
        const item = obj.item as { type?: string; text?: string };
        if (item.type === 'agent_message' && item.text) {
          return { type: 'stdout', data: item.text };
        }
      }
      if (typeof obj.content === 'string') {
        return { type: 'stdout', data: obj.content };
      }
      return { type: 'stdout', data: trimmed };
    } catch {
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (sessionId) {
      return {
        file: 'codex',
        args: ['exec', 'resume', sessionId],
        cwd: thread.worktreePath,
      };
    }
    return { file: 'codex', args: [], cwd: thread.worktreePath };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only: id, identifier, title, url, labels.';
    const { stdout, exitCode } = await run(
      'codex',
      [
        'exec',
        prompt,
        '--json',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
      ],
      { reject: false },
    );
    if (exitCode !== 0) return [];
    const match = stdout.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]) as IssueInfo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
};
