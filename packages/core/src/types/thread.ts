export type AgentKind = 'claude' | 'codex' | 'opencode' | 'brightsy' | 'cursor';

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

/** Structured agent turn content (thinking / tools / text). */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input?: Record<string, unknown>;
      /** Short human label (e.g. "Fetch latest from origin"). */
      description?: string;
      /** Command / path shown in the monospace pill. */
      detail?: string;
      result?: string;
      status: 'running' | 'done' | 'error';
      filePath?: string;
      additions?: number;
      deletions?: number;
    };

/** Token usage for a single agent turn, aggregated across the turn's API calls. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ThreadMessage {
  role: 'user' | 'agent' | 'summary';
  text: string;
  /** Structured parts for expandable tool/thinking UI. Optional for older threads. */
  parts?: MessagePart[];
  /** Agent turn duration in milliseconds (from turn start to message persist). */
  durationMs?: number;
  /** Token usage for this turn, when the agent CLI reports it. */
  usage?: TokenUsage;
  ts: string;
}

/** Composer / turn attachment (e.g. forked chat transcript). */
export interface ThreadAttachment {
  id: string;
  name: string;
  kind: 'transcript' | 'file' | 'issue' | 'workspace' | 'diff-comment';
  content: string;
  /** Worktree-relative path when this attachment is a real file that can be opened in a tab. */
  path?: string;
  /** data: URL thumbnail for image attachments shown in the composer (pending only). */
  previewDataUrl?: string;
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
  /** Agent model alias (e.g. sonnet, opus). null = Auto / CLI default. */
  model: string | null;
  /** Prefer faster/cheaper turns (Claude: --effort low). */
  fast: boolean;
  /** Plan-only turns — analyze and plan without editing files (Conductor-style). */
  planMode: boolean;
  sessionId: string | null;
  autonomy: Autonomy;
  sourceIsFork: boolean;
  status: ThreadStatus;
  queue: string[];
  parentThreadId: string | null;
  /** Port of the default/primary run script (legacy + sidebar). */
  devPort: number | null;
  /** Named run scripts currently tracked for this thread. */
  activeRuns?: ActiveRun[];
  prUrl: string | null;
  /** Cached PR title for Conductor-style sidebar labels (PR title > branch). */
  prTitle: string | null;
  /** When true, `title` is a manual override and is not overwritten by branch/PR sync. */
  userSetTitle: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
  /** Pending composer attachments (forked transcripts, etc.). */
  attachments: ThreadAttachment[];
  lastError?: string | null;
  /**
   * OS pid of the in-flight agent child while status is `running`.
   * Used so other processes (MCP) do not reclaim a live turn as dead.
   */
  agentPid?: number | null;
}

export interface CreateChatTabInput {
  /** Existing thread in the worktree to clone workspace metadata from. */
  fromThreadId: string;
  agent?: AgentKind;
  model?: string | null;
  autonomy?: Autonomy;
  title?: string;
  attachments?: ThreadAttachment[];
}

export interface ForkChatTabInput {
  threadId: string;
  /** Inclusive message index to fork through; default = all messages. */
  throughIndex?: number;
  agent?: AgentKind;
  title?: string;
}

/** Fork a thread into a new git worktree (new branch + worktree dir). */
export interface ForkThreadWorktreeInput {
  threadId: string;
  /** Inclusive message index to seed transcript through; default = all messages. */
  throughIndex?: number;
  agent?: AgentKind;
  title?: string;
}

export interface ThreadOptionsPatch {
  agent?: AgentKind;
  model?: string | null;
  fast?: boolean;
  planMode?: boolean;
  autonomy?: Autonomy;
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

/** One CI check from `gh pr checks --json`, or a synthetic merge/review gate. */
export interface PrCheckRun {
  name: string;
  state: string;
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel' | string;
  startedAt: string | null;
  completedAt: string | null;
  link: string | null;
  description: string | null;
  workflow: string | null;
  /**
   * Origin of the row. Omitted / `ci` = GitHub Actions / check suite.
   * `mergeability` / `review` are Sideboard synthetics (conflicts, behind, review).
   */
  kind?: 'ci' | 'mergeability' | 'review';
}

export interface PrActor {
  login: string;
  name?: string | null;
}

export interface PrCommitInfo {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  authors: PrActor[];
}

export interface PrCommentInfo {
  author: PrActor;
  body: string;
  createdAt: string;
}

export interface PrReviewInfo {
  author: PrActor;
  state: string;
  body: string;
  submittedAt: string | null;
}

/** Rich PR payload for Sideboard Review tab (`gh pr view --json`). */
export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  author: PrActor;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: PrCommitInfo[];
  comments: PrCommentInfo[];
  reviews: PrReviewInfo[];
  /** Prefer `getPrChecks` — kept for callers; often empty to avoid nested GraphQL. */
  checks: PrCheckRun[];
}

/** Lightweight PR fields for the sidebar pill (cheap GraphQL). */
export interface PrMeta {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  baseRefName: string;
  headRefName: string;
}

export interface IssueInfo {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];
  /** When set, which tracker produced this issue. */
  provider?: 'linear' | 'github';
}

export interface DiffFile {
  path: string;
  /** Git name-status letter (M/A/D/R/…). */
  status: string;
  patch: string;
  /** From `git diff --numstat` when available. */
  additions?: number;
  deletions?: number;
}

/** Cursor-style Changes panel filters. */
export type DiffScope =
  | 'last_turn'
  | 'uncommitted'
  | 'staged'
  | 'unstaged'
  | 'commits';

export interface DiffScopeStat {
  files: number;
  additions: number;
  deletions: number;
}

/** One commit on the branch (for the Changes → Commits submenu). */
export interface DiffCommit {
  sha: string;
  shortSha: string;
  subject: string;
  relativeTime: string;
}

export interface DiffResult {
  /** Active filter for this result. */
  scope: DiffScope;
  /** When scope is commits and a single commit is selected. */
  commitSha?: string | null;
  base: string;
  files: DiffFile[];
  stat: string;
  dirty: boolean;
  /** Commits on HEAD not yet on the remote tracking branch (0 if none/unknown). */
  unpushed: number;
  /** Counts for each filter option (for the Changes dropdown). */
  scopeStats: Record<DiffScope, DiffScopeStat>;
  /** True when a last-agent-turn baseline is available. */
  hasLastTurnBase: boolean;
  /** Recent commits on the branch (vs merge-base), for the Commits flyout. */
  commits: DiffCommit[];
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
  | { type: 'thinking'; data: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input?: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      id: string;
      content?: string;
      isError?: boolean;
    }
  | { type: 'usage'; data: TokenUsage }
  | { type: 'exit'; data: number | null };

export type OrchestratorEvent =
  | { type: 'turn_started'; threadId: string; prompt: string }
  | { type: 'turn_output'; threadId: string; event: AgentEvent }
  | { type: 'turn_finished'; threadId: string; exitCode: number | null }
  | { type: 'status_changed'; threadId: string; status: ThreadStatus }
  | { type: 'queue_changed'; threadId: string; queue: string[] }
  | {
      type: 'context_compacted';
      threadId: string;
      olderCount: number;
      method: 'claude' | 'extractive';
    }
  | { type: 'dev_server_started'; threadId: string; port: number; scriptName?: string }
  | { type: 'dev_server_stopped'; threadId: string; scriptName?: string }
  | {
      type: 'run_output';
      threadId: string;
      scriptName: string;
      line: string;
    }
  | { type: 'setup_started'; threadId: string }
  | { type: 'setup_output'; threadId: string; line: string }
  | { type: 'setup_finished'; threadId: string; exitCode: number | null }
  | {
      type: 'orphan_worktrees';
      orphans: Array<{ path: string; repoPath: string }>;
    }
  | { type: 'error'; threadId: string; message: string };

/** Active named run script (in-memory + mirrored on thread for UI). */
export interface ActiveRun {
  scriptName: string;
  port: number;
  ports: number[];
  startedAt: string;
}

/** Live snapshot for the global orchestrator board. */
export interface OrchestratorRuntime {
  running: number;
  maxConcurrent: number;
  queued: number;
  idle: number;
  error: number;
  stopped: number;
  broken: number;
  totalActive: number;
}

export interface CreateThreadInput {
  sourceType: Exclude<SourceType, 'orchestration'>;
  sourceRef: string;
  agent: AgentKind;
  repoPath: string;
  autonomy?: Autonomy;
  /** Claude model id, or Brightsy `agent:` / `model:` target encoding. */
  model?: string | null;
  fast?: boolean;
  planMode?: boolean;
  /** Attachments available to the first prompt (and subsequent turns). */
  attachments?: ThreadAttachment[];
  title?: string;
  parentThreadId?: string | null;
  /** Optional first prompt — queued after the thread is created (Conductor-style). */
  prompt?: string;
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
