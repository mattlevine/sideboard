import type {
  AdoptInput,
  AgentKind,
  AgentStatus,
  BranchInfo,
  ConductorWorkspace,
  CreateThreadInput,
  DiffResult,
  IssueInfo,
  LandPreview,
  LandResult,
  OrchestratorEvent,
  PrInfo,
  Thread,
} from '../types/thread.js';

/** Shared typed surface for Electron preload ↔ renderer (and docs). */
export interface IpcApi {
  detectAgents(): Promise<AgentStatus[]>;
  listBranches(repoPath: string): Promise<BranchInfo[]>;
  listPrs(repoPath: string): Promise<PrInfo[]>;
  listLinearIssues(agent: AgentKind, repoPath: string): Promise<IssueInfo[]>;
  resolveRepoRoot(cwd: string): Promise<string>;
  getThreads(includeArchived?: boolean): Promise<Thread[]>;
  getThread(idOrRef: string): Promise<Thread | null>;
  createThread(input: CreateThreadInput): Promise<Thread>;
  adopt(input: AdoptInput): Promise<Thread>;
  listConductor(): Promise<ConductorWorkspace[]>;
  adoptFromConductor(workspaceId: string): Promise<Thread>;
  sendToThread(threadRef: string, prompt: string): Promise<Thread>;
  fanOut(threadRefs: string[], prompt: string): Promise<Thread[]>;
  startOrchestration(opts: {
    goal: string;
    agent: AgentKind;
    repoPath: string;
  }): Promise<Thread>;
  stopThread(threadRef: string): Promise<Thread>;
  getDiff(threadRef: string): Promise<DiffResult>;
  openInEditor(threadRef: string, editor?: string): Promise<void>;
  runDevScript(threadRef: string): Promise<{ port: number }>;
  stopDevScript(threadRef: string): Promise<void>;
  previewLand(threadRef: string): Promise<LandPreview>;
  confirmLand(threadRef: string): Promise<LandResult>;
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
  hasConductorHook(repoPath: string): Promise<boolean>;
}
