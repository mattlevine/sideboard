import type { AgentEvent, AgentKind, AgentStatus, Autonomy, Thread } from '../types/thread.js';

export interface TurnCommand {
  file: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AttachCommand {
  file: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AgentAdapter {
  kind: AgentKind;
  detect(): Promise<AgentStatus>;
  buildTurn(thread: Thread, prompt: string): Promise<TurnCommand>;
  parseEvent(line: string): AgentEvent | null;
  resolveSessionId(worktreePath: string, cached: string | null): Promise<string | null>;
  buildAttach(thread: Thread): Promise<AttachCommand>;
  /** Optional: list Linear issues via this agent's MCP connector */
  listLinearIssues?(repoPath: string): Promise<
    Array<{ id: string; identifier: string; title: string; url: string; labels: string[] }>
  >;
}

export function permissionMode(autonomy: Autonomy): {
  claude: string;
  opencodePermission: string;
} {
  if (autonomy === 'full') {
    return {
      claude: 'bypassPermissions',
      opencodePermission: JSON.stringify({ '*': 'allow' }),
    };
  }
  return {
    claude: 'acceptEdits',
    opencodePermission: JSON.stringify({
      edit: 'allow',
      bash: { '*': 'allow', 'rm -rf *': 'deny' },
    }),
  };
}
