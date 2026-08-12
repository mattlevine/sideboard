import type { AgentEvent, AgentKind, AgentStatus, Thread } from '../types/thread.js';
import type { AgentTurnInput } from './turn-input.js';

export type { AgentTurnInput } from './turn-input.js';

export interface TurnCommand {
  file: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** When set, written to the child process stdin (e.g. Claude stream-json). */
  stdin?: string;
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
  buildTurn(thread: Thread, input: string | AgentTurnInput): Promise<TurnCommand>;
  parseEvent(line: string): AgentEvent | AgentEvent[] | null;
  resolveSessionId(worktreePath: string, cached: string | null): Promise<string | null>;
  buildAttach(thread: Thread): Promise<AttachCommand>;
  /** Optional: list Linear issues via this agent's MCP connector */
  listLinearIssues?(repoPath: string): Promise<
    Array<{ id: string; identifier: string; title: string; url: string; labels: string[] }>
  >;
}

export const PLAN_MODE_INSTRUCTION =
  'Plan mode is active and must remain active until the user turns Plan mode off in the UI (or Approves / Hands off the plan). Analyze the codebase, search and read files as needed, and produce or refine a clear implementation plan. Do not modify, create, or delete any project files except via Sideboard MCP present_plan (writes .context/attachments/plan.md). When you need a clarifying decision (approach forks, auth choice, scope): (1) first write a short chat message that explains the decision and what each option means (tradeoffs, when to pick it) — do not leave the user staring at bare labels; (2) then call Sideboard MCP ask_user with the same options, including a description on every option. Sideboard shows questions in the composer and mirrors them in chat. After ask_user, wait for the user\'s next message with their answers before finalizing the plan. When the plan is ready for approval: (1) call present_plan with the full markdown plan (title + content) so Sideboard saves .context/attachments/plan.md and shows it in chat for Approve / Hand off / Copy; (2) Claude should also call ExitPlanMode after present_plan. Do not skip present_plan — the plan must be a markdown file, not only chat prose.';

export function permissionMode(
  thread: Pick<Thread, 'autonomy' | 'planMode' | 'sourceType'>,
): {
  claude: string;
  opencodePermission: string;
  codexSandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
} {
  // Orchestrators spawn Sideboard MCP which creates worktrees + thread files
  // outside `--cd`. Codex workspace-write can seatbelt those MCP children and
  // hang create_thread; Claude does not — so Claude orch works and Codex does not.
  if (thread.sourceType === 'orchestration') {
    return {
      claude: 'acceptEdits',
      opencodePermission: JSON.stringify({
        edit: 'allow',
        bash: { '*': 'allow', 'rm -rf *': 'deny' },
      }),
      codexSandbox: 'danger-full-access',
    };
  }
  if (thread.planMode) {
    return {
      claude: 'plan',
      opencodePermission: JSON.stringify({
        edit: 'deny',
        write: 'deny',
        bash: { '*': 'deny' },
      }),
      codexSandbox: 'read-only',
    };
  }
  if (thread.autonomy === 'full') {
    return {
      claude: 'bypassPermissions',
      opencodePermission: JSON.stringify({ '*': 'allow' }),
      codexSandbox: 'workspace-write',
    };
  }
  return {
    claude: 'acceptEdits',
    opencodePermission: JSON.stringify({
      edit: 'allow',
      bash: { '*': 'allow', 'rm -rf *': 'deny' },
    }),
    codexSandbox: 'workspace-write',
  };
}
