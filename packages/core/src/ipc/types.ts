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
  PrMeta,
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
  /**
   * Auth for schema CMS pane (`@brightsy/client` in the renderer).
   * Returns null fields + reason when not logged in.
   */
  getBrightsyCmsAuth(): Promise<{
    endpoint: string;
    accessToken: string | null;
    accountId: string | null;
    accountSlug: string | null;
    reason?: string;
  }>;
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
  listBranches(repoPath: string, opts?: { unmergedOnly?: boolean }): Promise<BranchInfo[]>;
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
  /**
   * Stage dropped/picked files into composer attachments. External files are
   * copied into `.sideboard/attachments/` in the thread worktree.
   */
  attachComposerFiles(
    threadRef: string,
    opts: {
      absolutePaths?: string[];
      relativePaths?: string[];
      /** When Electron hides File.path, renderer sends file bytes instead. */
      buffers?: Array<{ name: string; dataBase64: string }>;
    },
  ): Promise<ThreadAttachment[]>;
  /**
   * Resolve an absolute filesystem path for a File from a drag/drop or picker.
   * Uses Electron `webUtils.getPathForFile` (File.path is unavailable under contextIsolation).
   */
  getPathForFile(file: File): string;
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
    /** Omit for Global workspace (home-less). */
    repoPath?: string;
    autonomy?: Autonomy;
    model?: string | null;
    fast?: boolean;
    planMode?: boolean;
    attachments?: ThreadAttachment[];
  }): Promise<Thread>;
  createGlobalChat(opts: {
    title?: string;
    agent: AgentKind;
    autonomy?: Autonomy;
    model?: string | null;
    fast?: boolean;
    planMode?: boolean;
    attachments?: ThreadAttachment[];
  }): Promise<Thread>;
  ensureCloudCoordinator(agent: AgentKind): Promise<Thread>;
  stopThread(threadRef: string): Promise<Thread>;
  getDiff(
    threadRef: string,
    opts?: { scope?: DiffScope; commitSha?: string | null },
  ): Promise<DiffResult>;
  /** `git init` in the thread worktree when Changes has no Git repo (Cursor-style). */
  initializeGit(threadRef: string): Promise<void>;
  /** CI checks for the thread's linked PR (`gh pr checks`). `null` = no PR. */
  getPrChecks(threadRef: string): Promise<PrCheckRun[] | null>;
  /** Lightweight PR fields for the sidebar pill (cheap GraphQL). */
  getPrMeta(threadRef: string): Promise<PrMeta | null>;
  /** PR description / reviews for the Review tab. */
  getPrDetails(threadRef: string): Promise<PrDetails | null>;
  listFiles(threadRef: string): Promise<string[]>;
  readFile(
    threadRef: string,
    relativePath: string,
  ): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    binary: boolean;
    encoding: 'utf8' | 'base64';
  }>;
  /** Full file bytes (base64) for CMS / file-manager upload from worktree paths. */
  readFileForUpload(
    threadRef: string,
    relativePath: string,
  ): Promise<{ path: string; contentBase64: string; size: number }>;
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
  runDevScript(
    threadRef: string,
    scriptName?: string,
  ): Promise<{ port: number; scriptName: string; ports: number[] }>;
  stopDevScript(threadRef: string, scriptName?: string): Promise<void>;
  listRunScripts(threadRef: string): Promise<
    Array<{
      name: string;
      command: string;
      default?: boolean;
      icon?: string;
    }>
  >;
  getActiveRuns(threadRef: string): Promise<
    Array<{ scriptName: string; port: number; ports: number[]; startedAt: string }>
  >;
  previewLand(threadRef: string): Promise<LandPreview>;
  confirmLand(
    threadRef: string,
    opts?: { draft?: boolean; web?: boolean },
  ): Promise<LandResult>;
  /** Merge the thread's linked PR on GitHub (`gh pr merge`). */
  mergePr(threadRef: string): Promise<{ url: string; state: string }>;
  archiveThread(threadRef: string): Promise<Thread>;
  purgeThread(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void>;
  restoreThread(threadRef: string): Promise<Thread>;
  applyIntoMain(
    threadRef: string,
    opts?: { method?: 'merge' | 'cherry-pick'; targetBranch?: string },
  ): Promise<{ applied: boolean; method: string; targetBranch: string; message: string }>;
  cloneRepo(url: string, name?: string): Promise<{ repoPath: string; workspace: Workspace }>;
  listOrphanWorktrees(repoPath?: string): Promise<Array<{ path: string; repoPath: string; mtimeMs: number }>>;
  cleanupOrphans(opts?: {
    dryRun?: boolean;
    maxCount?: number;
    repoPath?: string;
  }): Promise<{ removed: string[]; kept: string[] }>;
  bestOfN(opts: {
    prompt: string;
    agents: AgentKind[];
    repoPath: string;
    sourceType?: 'branch' | 'pr' | 'ticket';
    sourceRef?: string;
    title?: string;
  }): Promise<Thread[]>;
  /** Attach into the native agent CLI (opens a PTY session when available). */
  attachThread(threadRef: string): Promise<{ file: string; args: string[]; cwd: string }>;
  /** Embedded terminal (PTY) IPC. */
  terminal: {
    start(threadRef: string, cols?: number, rows?: number): Promise<{ id: string }>;
    /** Start a PTY running the native agent attach command. */
    attach(threadRef: string, cols?: number, rows?: number): Promise<{ id: string }>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    onData(listener: (payload: { id: string; data: string }) => void): () => void;
    onExit(listener: (payload: { id: string; exitCode: number | null }) => void): () => void;
  };
  /** Subscribe to orchestrator events; returns unsubscribe. */
  onEvent(listener: (event: OrchestratorEvent) => void): () => void;
  /** Subscribe to store directory changes (CLI threads appear live). */
  onThreadsChanged(listener: () => void): () => void;
  getRepoPath(): Promise<string>;
  setRepoPath(path: string): Promise<string>;
  pickRepoPath(): Promise<string | null>;
  /**
   * Native file picker; returns attachments ready for the composer.
   * When `threadRef` is set, files are staged into the worktree (same as drop).
   */
  pickFiles(threadRef?: string | null): Promise<ThreadAttachment[]>;
  /** Build composer attachments from absolute paths without a worktree (create modal). */
  attachmentsFromPaths(absolutePaths: string[]): Promise<ThreadAttachment[]>;
  /** Build composer attachments from in-memory file buffers (create modal drop fallback). */
  attachmentsFromBuffers(
    buffers: Array<{ name: string; dataBase64: string }>,
  ): Promise<ThreadAttachment[]>;
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
  /**
   * Publish HTML for the artifact side-column iframe (custom protocol bypasses
   * renderer CSP so inline scripts can run).
   */
  publishArtifactPreview(id: string, html: string): Promise<{ url: string }>;
  clearArtifactPreview(id: string): Promise<void>;
  /**
   * In-app URL preview via BrowserView (top-level navigation — works for
   * sites that block iframes, e.g. GitHub).
   */
  urlPreview: {
    show(opts: {
      url: string;
      bounds: { x: number; y: number; width: number; height: number };
    }): Promise<void>;
    setBounds(bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): Promise<void>;
    navigate(url: string): Promise<void>;
    reload(): Promise<void>;
    hide(): Promise<void>;
    onNavigated(listener: (payload: { url: string }) => void): () => void;
  };
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
