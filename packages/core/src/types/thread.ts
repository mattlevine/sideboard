export type AgentKind = 'claude' | 'codex' | 'opencode';

export type SourceType = 'branch' | 'pr' | 'ticket' | 'orchestration' | 'adopt';

export type ThreadStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'stopped'
  | 'error'
  | 'broken'
  | 'archived';

export type Autonomy = 'default' | 'full';

export interface ThreadMessage {
  role: 'user' | 'agent';
  text: string;
  ts: string;
}

export interface Thread {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceRef: string;
  branchName: string;
  worktreePath: string;
  repoPath: string;
  agent: AgentKind;
  sessionId: string | null;
  autonomy: Autonomy;
  sourceIsFork: boolean;
  status: ThreadStatus;
  queue: string[];
  parentThreadId: string | null;
  devPort: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
  lastError?: string | null;
}

export interface AgentStatus {
  agent: AgentKind;
  installed: boolean;
  authenticated: boolean;
  linearMcp: boolean;
  warnings: string[];
  reason?: string;
}

export interface BranchInfo {
  name: string;
  remote: boolean;
  current: boolean;
}

export interface PrInfo {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  isCrossRepository: boolean;
}

export interface IssueInfo {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];
}

export interface DiffFile {
  path: string;
  status: string;
  patch: string;
}

export interface DiffResult {
  base: string;
  files: DiffFile[];
  stat: string;
  dirty: boolean;
}

export interface LandPreview {
  branch: string;
  target: string;
  diffStat: string;
  dirty: boolean;
  blocked: boolean;
  blockReason?: string;
  isFork: boolean;
}

export interface LandResult {
  prUrl: string;
  pushed: boolean;
  committed: boolean;
}

export type AgentEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'session_id'; data: string }
  | { type: 'exit'; data: number | null };

export type OrchestratorEvent =
  | { type: 'turn_started'; threadId: string; prompt: string }
  | { type: 'turn_output'; threadId: string; event: AgentEvent }
  | { type: 'turn_finished'; threadId: string; exitCode: number | null }
  | { type: 'status_changed'; threadId: string; status: ThreadStatus }
  | { type: 'queue_changed'; threadId: string; queue: string[] }
  | { type: 'dev_server_started'; threadId: string; port: number }
  | { type: 'dev_server_stopped'; threadId: string }
  | { type: 'error'; threadId: string; message: string };

export interface CreateThreadInput {
  sourceType: Exclude<SourceType, 'orchestration'>;
  sourceRef: string;
  agent: AgentKind;
  repoPath: string;
  autonomy?: Autonomy;
  title?: string;
  parentThreadId?: string | null;
}

export interface AdoptInput {
  worktreePath: string;
  agent: AgentKind;
  title?: string;
  sessionId?: string | null;
  messages?: ThreadMessage[];
  sourceRef?: string;
}

export interface ConductorWorkspace {
  id: string;
  workspacePath: string;
  branch: string;
  workspaceName: string;
  prTitle: string | null;
  prDescription: string | null;
  intendedTargetBranch: string | null;
  notes: string | null;
  claudeSessionId: string | null;
  agentType: AgentKind | null;
  messageCount: number;
}
