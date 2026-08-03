import type {
  AdoptInput,
  AgentKind,
  AgentStatus,
  Autonomy,
  BranchInfo,
  ConductorWorkspace,
  CreateChatTabInput,
  CreateThreadInput,
  DiffResult,
  DiffScope,
  ForkChatTabInput,
  ForkThreadWorktreeInput,
  ThreadAttachment,
  IssueInfo,
  LandPreview,
  LandResult,
  OrchestratorEvent,
  OrchestratorRuntime,
  PrCheckRun,
  PrDetails,
  PrInfo,
  Thread,
  ThreadOptionsPatch,
} from '../types/thread.js';
import type {
  AdvancedAppSettings,
  AppSettings,
  BrightsyCloudConnectAgent,
  BrightsyHarnessSettings,
  ClaudeHarnessSettings,
  IssueSource,
} from '../store/app-settings.js';
import type { Workspace } from '../store/workspaces.js';
import type { BrightsyChatTargets } from '../agents/brightsy-targets.js';
import type { BrightsySession } from '../brightsy/accounts.js';
import type { GitHubStatus } from '../integrations/github.js';
import type { ListIssuesResult } from '../integrations/issues.js';

/** Live status of the Brightsy cloud connect daemon in the desktop app. */
export interface CloudConnectStatus {
  enabled: boolean;
  running: boolean;
  agent: BrightsyCloudConnectAgent;
  endpoint: string | null;
  workspaces: Workspace[];
  lastError: string | null;
  lastLog: string | null;
}

/** Shared typed surface for Electron preload ↔ renderer (and docs). */
export interface IpcApi {
  detectAgents(): Promise<AgentStatus[]>;
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: AppSettings): Promise<AppSettings>;
  updateAppEnvironment(patch: Record<string, string | null | undefined>): Promise<AppSettings>;
  updateClaudeSettings(
    patch: Partial<ClaudeHarnessSettings> & { executablePath?: string | null },
  ): Promise<AppSettings>;
  /** Native file picker for a Claude Code executable override. */
  pickClaudeExecutable(): Promise<string | null>;
  /** Absolute path for PATH `claude`, or null if missing. */
  resolveSystemClaudePath(): Promise<string | null>;
  /** Ensure `~/.claude/settings.json` exists and open it in the OS default app. */
  openClaudeUserSettings(): Promise<void>;
  listBrightsyChatTargets(): Promise<BrightsyChatTargets>;
  /** Brightsy login + connected teams (shared by CLI, Brightsy agent, and Claude MCP). */
  getBrightsySession(): Promise<BrightsySession>;
  /** Connect/activate a team for CLI + MCP (same as connectBrightsyTeam). */
  switchBrightsyAccount(accountIdOrSlug: string): Promise<BrightsySession>;
  /** Connect a team for CLI + MCP; activates it as the CLI session. */
  connectBrightsyTeam(accountIdOrSlug: string): Promise<BrightsySession>;
  /** Disconnect a team from the shared CLI + MCP selection. */
  disconnectBrightsyTeam(accountIdOrSlug: string): Promise<BrightsySession>;
  /** Brightsy cloud remote orchestrator status (desktop daemon). */
  getCloudConnectStatus(): Promise<CloudConnectStatus>;
  /** Enable/disable cloud connect and optionally set the coordinator agent. */
  setCloudConnect(opts: {
    enabled?: boolean;
    agent?: BrightsyCloudConnectAgent;
  }): Promise<CloudConnectStatus>;
  updateBrightsySettings(
    patch: Partial<BrightsyHarnessSettings> & {
      cloudConnectAgent?: BrightsyCloudConnectAgent | null;
    },
  ): Promise<AppSettings>;
  updateAdvancedSettings(patch: Partial<AdvancedAppSettings>): Promise<AppSettings>;
  updateIntegrationsSettings(patch: {
    linearApiKey?: string | null;
    issueSource?: IssueSource | null;
  }): Promise<AppSettings>;
  /** Machine-global GitHub status via `gh`. */
  getGitHubStatus(): Promise<GitHubStatus>;
  /**
   * Unified issues for Create-from / Link issue (Linear API or GitHub Issues,
   * based on Account preference with Linear→GitHub fallback).
   */
  listIssues(repoPath: string): Promise<ListIssuesResult>;
  listBranches(repoPath: string): Promise<BranchInfo[]>;
  listPrs(repoPath: string): Promise<PrInfo[]>;
  /** @deprecated Prefer listIssues — agent Linear MCP. */
  listLinearIssues(agent: AgentKind, repoPath: string): Promise<IssueInfo[]>;
  resolveRepoRoot(cwd: string): Promise<string>;
  getThreads(includeArchived?: boolean): Promise<Thread[]>;
  getThread(idOrRef: string): Promise<Thread | null>;
  getRuntime(): Promise<OrchestratorRuntime>;
  setMaxConcurrent(n: number): Promise<void>;
  createThread(input: CreateThreadInput): Promise<Thread>;
  createChatTab(input: CreateChatTabInput): Promise<Thread>;
  forkChatTab(input: ForkChatTabInput): Promise<Thread>;
  forkThreadWorktree(input: ForkThreadWorktreeInput): Promise<Thread>;
  renameThread(threadRef: string, title: string): Promise<Thread>;
  setAttachments(threadRef: string, attachments: ThreadAttachment[]): Promise<Thread>;
  listWorktreeChats(threadRef: string): Promise<Thread[]>;
  listWorkspaces(): Promise<Workspace[]>;
  addWorkspace(repoPath: string): Promise<Workspace>;
  removeWorkspace(repoPath: string): Promise<void>;
  adopt(input: AdoptInput): Promise<Thread>;
  listConductor(): Promise<ConductorWorkspace[]>;
  adoptFromConductor(workspaceId: string): Promise<Thread>;
  sendToThread(threadRef: string, prompt: string): Promise<Thread>;
  setAutonomy(threadRef: string, autonomy: Autonomy): Promise<Thread>;
  setThreadOptions(threadRef: string, patch: ThreadOptionsPatch): Promise<Thread>;
  fanOut(threadRefs: string[], prompt: string): Promise<Thread[]>;
  startOrchestration(opts: {
    goal: string;
    agent: AgentKind;
    repoPath: string;
    autonomy?: Autonomy;
    model?: string | null;
    fast?: boolean;
    planMode?: boolean;
    attachments?: ThreadAttachment[];
  }): Promise<Thread>;
  stopThread(threadRef: string): Promise<Thread>;
  getDiff(
    threadRef: string,
    opts?: { scope?: DiffScope; commitSha?: string | null },
  ): Promise<DiffResult>;
  /** `git init` in the thread worktree when Changes has no Git repo (Cursor-style). */
  initializeGit(threadRef: string): Promise<void>;
  /** CI checks for the thread's linked PR (`gh pr checks`). */
  getPrChecks(threadRef: string): Promise<PrCheckRun[]>;
  /** PR description / commits / reviews for the Review tab. */
  getPrDetails(threadRef: string): Promise<PrDetails | null>;
  listFiles(threadRef: string): Promise<string[]>;
  readFile(
    threadRef: string,
    relativePath: string,
  ): Promise<{ path: string; content: string; truncated: boolean; binary: boolean }>;
  writeFile(threadRef: string, relativePath: string, content: string): Promise<{ path: string }>;
  /** Watch the open file in the worktree; replaces any previous watch. */
  watchOpenFile(threadRef: string, relativePath: string): Promise<void>;
  unwatchOpenFile(): Promise<void>;
  /** Fired when the watched open file changes on disk. */
  onOpenFileChanged(
    listener: (payload: { threadRef: string; path: string }) => void,
  ): () => void;
  listSkills(threadRef: string): Promise<
    Array<{
      id: string;
      name: string;
      command: string;
      description: string;
      path: string;
      source: 'workspace' | 'user' | 'cli';
    }>
  >;
  openInEditor(threadRef: string, editor?: string, relativePath?: string): Promise<void>;
  openWorktree(
    threadRef: string,
    target: 'finder' | 'cursor' | 'code' | 'xcode' | 'terminal' | 'datagrip',
  ): Promise<void>;
  runDevScript(threadRef: string): Promise<{ port: number }>;
  stopDevScript(threadRef: string): Promise<void>;
  previewLand(threadRef: string): Promise<LandPreview>;
  confirmLand(
    threadRef: string,
    opts?: { draft?: boolean; web?: boolean },
  ): Promise<LandResult>;
  archiveThread(threadRef: string): Promise<Thread>;
  purgeThread(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void>;
  restoreThread(threadRef: string): Promise<Thread>;
  /** Subscribe to orchestrator events; returns unsubscribe. */
  onEvent(listener: (event: OrchestratorEvent) => void): () => void;
  /** Subscribe to store directory changes (CLI threads appear live). */
  onThreadsChanged(listener: () => void): () => void;
  getRepoPath(): Promise<string>;
  setRepoPath(path: string): Promise<string>;
  pickRepoPath(): Promise<string | null>;
  /** Native file picker; returns attachments ready for the composer. */
  pickFiles(): Promise<ThreadAttachment[]>;
  /** Prefer worktree settings; optional main-repo fallback. */
  hasConductorHook(worktreePath: string, repoPath?: string | null): Promise<boolean>;
  getRepoSetupInfo(
    worktreePath: string,
    repoPath?: string | null,
  ): Promise<{
    hasConfig: boolean;
    hasSetupScript: boolean;
    configLabel: string | null;
  }>;
  runSetup(threadRef: string): Promise<{ exitCode: number | null }>;
  openExternal(url: string): Promise<void>;
  /** Main-process tsserver for real import/type diagnostics in the file UI. */
  tsserver: {
    start(worktreePath?: string): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<{ success: boolean; error?: string }>;
    isRunning(): Promise<boolean>;
    openFile(absPath: string, content?: string): Promise<{ success: boolean; error?: string }>;
    closeFile(absPath: string): Promise<{ success: boolean; error?: string }>;
    updateFile(absPath: string, content: string): Promise<{ success: boolean; error?: string }>;
    diagnostics(absPath: string): Promise<{
      success: boolean;
      error?: string;
      semanticSeq?: number;
      syntacticSeq?: number;
    }>;
    onMessage(listener: (message: unknown) => void): () => void;
  };
}
