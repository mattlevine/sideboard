import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo } from '../types/thread.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';
import { permissionMode } from './types.js';

export const opencodeAdapter: AgentAdapter = {
  kind: 'opencode',

  async detect(): Promise<AgentStatus> {
    const which = await run('which', ['opencode'], { reject: false });
    if (which.exitCode !== 0) {
      return {
        agent: 'opencode',
        installed: false,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason: 'opencode CLI not found on PATH',
      };
    }

    const auth = await run('opencode', ['auth', 'list'], { reject: false });
    const authenticated = auth.exitCode === 0 && auth.stdout.trim().length > 0;

    const mcp = await run('opencode', ['mcp', 'list'], { reject: false });
    const linearMcp = /linear/i.test(mcp.stdout + mcp.stderr);

    return {
      agent: 'opencode',
      installed: true,
      authenticated,
      linearMcp,
      warnings: [],
      reason: authenticated
        ? undefined
        : 'opencode auth list empty — run `opencode auth login`',
    };
  },

  async buildTurn(thread, prompt): Promise<TurnCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const mode = permissionMode(thread.autonomy);
    // Never use --continue — it's global under concurrency. Always --session <id>.
    const args = [
      'run',
      prompt,
      '--dir',
      thread.worktreePath,
      '--format',
      'json',
    ];
    if (sessionId) {
      args.push('--session', sessionId);
    }
    return {
      file: 'opencode',
      args,
      cwd: thread.worktreePath,
      env: {
        OPENCODE_PERMISSION: mode.opencodePermission,
      },
    };
  },

  parseEvent(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const sid =
        (typeof obj.sessionID === 'string' && obj.sessionID) ||
        (typeof obj.sessionId === 'string' && obj.sessionId) ||
        (typeof obj.session_id === 'string' && obj.session_id);
      if (sid) return { type: 'session_id', data: sid };

      if (obj.type === 'text') {
        const text =
          (obj as { part?: { text?: string }; text?: string }).part?.text ??
          (obj as { text?: string }).text;
        if (text) return { type: 'stdout', data: text };
      }
      if (obj.type === 'tool_use' || obj.type === 'tool_result') {
        return { type: 'stdout', data: trimmed };
      }
      if (obj.type === 'error') {
        return {
          type: 'stderr',
          data: String((obj as { error?: string }).error ?? trimmed),
        };
      }
      return { type: 'stdout', data: trimmed };
    } catch {
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(worktreePath, cached): Promise<string | null> {
    const listed = await run(
      'opencode',
      ['session', 'list', '--format', 'json'],
      { cwd: worktreePath, reject: false },
    );
    if (listed.exitCode === 0 && listed.stdout.trim()) {
      try {
        const sessions = JSON.parse(listed.stdout) as Array<{
          id?: string;
          directory?: string;
          path?: string;
          updated?: string;
        }>;
        if (Array.isArray(sessions) && sessions.length > 0) {
          const match = sessions.find(
            (s) =>
              s.directory === worktreePath ||
              s.path === worktreePath ||
              (s.directory && worktreePath.startsWith(s.directory)),
          );
          if (match?.id) return match.id;
        }
      } catch {
        // fall through
      }
    }
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const args = sessionId ? ['--session', sessionId] : [];
    return {
      file: 'opencode',
      args,
      cwd: thread.worktreePath,
      env: {
        OPENCODE_PERMISSION: permissionMode(thread.autonomy).opencodePermission,
      },
    };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only: id, identifier, title, url, labels.';
    const { stdout, exitCode } = await run(
      'opencode',
      ['run', prompt, '--format', 'json'],
      {
        reject: false,
        env: { OPENCODE_PERMISSION: JSON.stringify({ '*': 'allow' }) },
      },
    );
    if (exitCode !== 0) return [];
    const texts: string[] = [];
    for (const line of stdout.split('\n')) {
      try {
        const obj = JSON.parse(line) as { type?: string; part?: { text?: string }; text?: string };
        if (obj.type === 'text') {
          texts.push(obj.part?.text ?? obj.text ?? '');
        }
      } catch {
        // ignore
      }
    }
    const joined = texts.join('');
    const match = joined.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return JSON.parse(match[0]) as IssueInfo[];
    } catch {
      return [];
    }
  },
};
