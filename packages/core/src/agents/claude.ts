import { run } from '../git/run.js';
import type { AgentEvent, AgentStatus, IssueInfo } from '../types/thread.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';
import { permissionMode } from './types.js';

function hasLinear(text: string): boolean {
  return /linear/i.test(text);
}

export const claudeAdapter: AgentAdapter = {
  kind: 'claude',

  async detect(): Promise<AgentStatus> {
    const which = await run('which', ['claude'], { reject: false });
    if (which.exitCode !== 0) {
      return {
        agent: 'claude',
        installed: false,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason: 'claude CLI not found on PATH',
      };
    }

    const auth = await run('claude', ['auth', 'status'], { reject: false });
    const authenticated = auth.exitCode === 0;

    const mcpJson = await run('claude', ['mcp', 'list', '--json'], { reject: false });
    let linearMcp = false;
    if (mcpJson.exitCode === 0 && mcpJson.stdout.trim()) {
      linearMcp = hasLinear(mcpJson.stdout);
    } else {
      const mcpText = await run('claude', ['mcp', 'list'], { reject: false });
      linearMcp = hasLinear(mcpText.stdout + mcpText.stderr);
    }

    return {
      agent: 'claude',
      installed: true,
      authenticated,
      linearMcp,
      warnings: [],
      reason: authenticated ? undefined : 'claude auth status failed — run `claude auth login`',
    };
  },

  async buildTurn(thread, prompt): Promise<TurnCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const mode = permissionMode(thread.autonomy);
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      mode.claude,
      '--allowedTools',
      'Edit,Write,Bash,Read,Glob,Grep,mcp__linear__*',
    ];
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    return {
      file: 'claude',
      args,
      cwd: thread.worktreePath,
    };
  },

  parseEvent(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.session_id === 'string') {
        return { type: 'session_id', data: obj.session_id };
      }
      if (obj.type === 'system' && typeof (obj as { session_id?: string }).session_id === 'string') {
        return { type: 'session_id', data: (obj as { session_id: string }).session_id };
      }
      // Claude stream-json often nests session id in init message
      if (obj.type === 'system' && obj.subtype === 'init') {
        const sid = (obj as { session_id?: string }).session_id;
        if (sid) return { type: 'session_id', data: sid };
      }
      if (obj.type === 'assistant') {
        const content = (obj as { message?: { content?: Array<{ type: string; text?: string }> } })
          .message?.content;
        const text = content
          ?.filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('') ?? '';
        if (text) return { type: 'stdout', data: text };
      }
      if (obj.type === 'content_block_delta') {
        const delta = (obj as { delta?: { text?: string } }).delta?.text;
        if (delta) return { type: 'stdout', data: delta };
      }
      if (typeof obj.result === 'string') {
        return { type: 'stdout', data: obj.result };
      }
      return { type: 'stdout', data: trimmed };
    } catch {
      return { type: 'stdout', data: line };
    }
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    // Prefer cached id; Claude's --continue is cwd-scoped but we always pass
    // an explicit --resume when we have one. Fresh sessions get their id from
    // the stream-json init event.
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const args = sessionId ? ['--resume', sessionId] : [];
    return { file: 'claude', args, cwd: thread.worktreePath };
  },

  async listLinearIssues(_repoPath: string): Promise<IssueInfo[]> {
    const prompt =
      'List my assigned Linear issues as JSON array only, no markdown. Each item: id, identifier, title, url, labels (string[]).';
    const { stdout, exitCode } = await run(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--permission-mode',
        'bypassPermissions',
        '--allowedTools',
        'mcp__linear__*',
      ],
      { reject: false },
    );
    if (exitCode !== 0) return [];
    return parseIssuesJson(stdout);
  },
};

function parseIssuesJson(raw: string): IssueInfo[] {
  const text = raw.trim();
  // Try whole string, then extract first [...] block
  const candidates = [text];
  const match = text.match(/\[[\s\S]*\]/);
  if (match) candidates.push(match[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          id: String(item.id ?? item.identifier ?? ''),
          identifier: String(item.identifier ?? item.id ?? ''),
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          labels: Array.isArray(item.labels)
            ? item.labels.map(String)
            : [],
        }));
      }
      // Claude --output-format json wraps result
      if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') {
        return parseIssuesJson(parsed.result);
      }
    } catch {
      // continue
    }
  }
  return [];
}
