import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { CaffeinateHoldState, IpcApi, OrchestratorEvent } from '@sideboard-ai/core';

const api: IpcApi = {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  detectAgents: () => ipcRenderer.invoke('detectAgents'),
  getAgentSetupInfo: (agent) => ipcRenderer.invoke('getAgentSetupInfo', agent),
  installAgent: (agent) => ipcRenderer.invoke('installAgent', agent),
  loginAgent: (agent) => ipcRenderer.invoke('loginAgent', agent),
  getAppSettings: () => ipcRenderer.invoke('getAppSettings'),
  saveAppSettings: (settings) => ipcRenderer.invoke('saveAppSettings', settings),
  updateAppEnvironment: (patch) => ipcRenderer.invoke('updateAppEnvironment', patch),
  updateClaudeSettings: (patch) => ipcRenderer.invoke('updateClaudeSettings', patch),
  updateAgentExecutable: (agent, executablePath) =>
    ipcRenderer.invoke('updateAgentExecutable', agent, executablePath),
  pickClaudeExecutable: () => ipcRenderer.invoke('pickClaudeExecutable'),
  pickAgentExecutable: (agent) => ipcRenderer.invoke('pickAgentExecutable', agent),
  resolveSystemClaudePath: () => ipcRenderer.invoke('resolveSystemClaudePath'),
  resolveSystemAgentPath: (agent) => ipcRenderer.invoke('resolveSystemAgentPath', agent),
  openClaudeUserSettings: () => ipcRenderer.invoke('openClaudeUserSettings'),
  listBrightsyChatTargets: () => ipcRenderer.invoke('listBrightsyChatTargets'),
  listCursorModels: () => ipcRenderer.invoke('listCursorModels'),
  listCodexModels: () => ipcRenderer.invoke('listCodexModels'),
  listOpencodeModels: () => ipcRenderer.invoke('listOpencodeModels'),
  getBrightsySession: () => ipcRenderer.invoke('getBrightsySession'),
  getBrightsyCmsAuth: () => ipcRenderer.invoke('getBrightsyCmsAuth'),
  switchBrightsyAccount: (accountIdOrSlug) =>
    ipcRenderer.invoke('switchBrightsyAccount', accountIdOrSlug),
  connectBrightsyTeam: (accountIdOrSlug) =>
    ipcRenderer.invoke('connectBrightsyTeam', accountIdOrSlug),
  disconnectBrightsyTeam: (accountIdOrSlug) =>
    ipcRenderer.invoke('disconnectBrightsyTeam', accountIdOrSlug),
  getCloudConnectStatus: () => ipcRenderer.invoke('getCloudConnectStatus'),
  setCloudConnect: (opts) => ipcRenderer.invoke('setCloudConnect', opts),
  updateBrightsySettings: (patch) =>
    ipcRenderer.invoke('updateBrightsySettings', patch),
  updateAdvancedSettings: (patch) =>
    ipcRenderer.invoke('updateAdvancedSettings', patch),
  updateIntegrationsSettings: (patch) =>
    ipcRenderer.invoke('updateIntegrationsSettings', patch),
  updateDefaultsSettings: (patch) =>
    ipcRenderer.invoke('updateDefaultsSettings', patch),
  getGitHubStatus: () => ipcRenderer.invoke('getGitHubStatus'),
  getSlackWorkspaces: () => ipcRenderer.invoke('getSlackWorkspaces'),
  connectSlackToken: (token) => ipcRenderer.invoke('connectSlackToken', token),
  startSlackOAuth: () => ipcRenderer.invoke('startSlackOAuth'),
  cancelSlackOAuth: () => ipcRenderer.invoke('cancelSlackOAuth'),
  startLinearOAuth: () => ipcRenderer.invoke('startLinearOAuth'),
  cancelLinearOAuth: () => ipcRenderer.invoke('cancelLinearOAuth'),
  disconnectLinear: () => ipcRenderer.invoke('disconnectLinear'),
  connectAbleTime: (input) => ipcRenderer.invoke('connectAbleTime', input),
  disconnectAbleTime: () => ipcRenderer.invoke('disconnectAbleTime'),
  connectOptionalService: (input) => ipcRenderer.invoke('connectOptionalService', input),
  disconnectOptionalService: (id) => ipcRenderer.invoke('disconnectOptionalService', id),
  detectOptionalServiceClis: () => ipcRenderer.invoke('detectOptionalServiceClis'),
  installOptionalServiceCli: (id) => ipcRenderer.invoke('installOptionalServiceCli', id),
  ensureAbleTimeTask: (input) => ipcRenderer.invoke('ensureAbleTimeTask', input),
  disconnectSlackWorkspace: (teamId) =>
    ipcRenderer.invoke('disconnectSlackWorkspace', teamId),
  getSlackListenStatus: () => ipcRenderer.invoke('getSlackListenStatus'),
  setSlackListen: (opts) => ipcRenderer.invoke('setSlackListen', opts),
  getCaffeinateHold: () => ipcRenderer.invoke('getCaffeinateHold'),
  onCaffeinateHoldChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: CaffeinateHoldState) => listener(state);
    ipcRenderer.on('caffeinate-hold:changed', handler);
    return () => {
      ipcRenderer.removeListener('caffeinate-hold:changed', handler);
    };
  },
  listIssues: (repoPath) => ipcRenderer.invoke('listIssues', repoPath),
  loadHomeBoard: (opts) => ipcRenderer.invoke('loadHomeBoard', opts),
  addBoardItem: (input) => ipcRenderer.invoke('addBoardItem', input),
  removeBoardItem: (id) => ipcRenderer.invoke('removeBoardItem', id),
  listBranches: (repoPath, opts) => ipcRenderer.invoke('listBranches', repoPath, opts),
  listPrs: (repoPath) => ipcRenderer.invoke('listPrs', repoPath),
  listLinearIssues: (agent, repoPath) => ipcRenderer.invoke('listLinearIssues', agent, repoPath),
  resolveRepoRoot: (cwd) => ipcRenderer.invoke('resolveRepoRoot', cwd),
  getThreads: (includeArchived) => ipcRenderer.invoke('getThreads', includeArchived),
  getThread: (idOrRef) => ipcRenderer.invoke('getThread', idOrRef),
  getRuntime: () => ipcRenderer.invoke('getRuntime'),
  setMaxConcurrent: (n) => ipcRenderer.invoke('setMaxConcurrent', n),
  createThread: (input) => ipcRenderer.invoke('createThread', input),
  createChatTab: (input) => ipcRenderer.invoke('createChatTab', input),
  requestReview: (threadRef) => ipcRenderer.invoke('requestReview', threadRef),
  forkChatTab: (input) => ipcRenderer.invoke('forkChatTab', input),
  forkThreadWorktree: (input) => ipcRenderer.invoke('forkThreadWorktree', input),
  renameThread: (threadRef, title) => ipcRenderer.invoke('renameThread', threadRef, title),
  setAttachments: (threadRef, attachments) =>
    ipcRenderer.invoke('setAttachments', threadRef, attachments),
  attachComposerFiles: (threadRef, opts) =>
    ipcRenderer.invoke('attachComposerFiles', threadRef, opts),
  listWorktreeChats: (threadRef) => ipcRenderer.invoke('listWorktreeChats', threadRef),
  listWorkspaces: () => ipcRenderer.invoke('listWorkspaces'),
  addWorkspace: (repoPath) => ipcRenderer.invoke('addWorkspace', repoPath),
  removeWorkspace: (repoPath) => ipcRenderer.invoke('removeWorkspace', repoPath),
  adopt: (input) => ipcRenderer.invoke('adopt', input),
  listConductor: () => ipcRenderer.invoke('listConductor'),
  adoptFromConductor: (workspaceId) => ipcRenderer.invoke('adoptFromConductor', workspaceId),
  sendToThread: (threadRef, prompt) => ipcRenderer.invoke('sendToThread', threadRef, prompt),
  editQueuedMessage: (threadRef, index, text) =>
    ipcRenderer.invoke('editQueuedMessage', threadRef, index, text),
  removeQueuedMessage: (threadRef, index) =>
    ipcRenderer.invoke('removeQueuedMessage', threadRef, index),
  sendQueuedMessageNow: (threadRef, index) =>
    ipcRenderer.invoke('sendQueuedMessageNow', threadRef, index),
  setAutonomy: (threadRef, autonomy) => ipcRenderer.invoke('setAutonomy', threadRef, autonomy),
  setThreadOptions: (threadRef, patch) =>
    ipcRenderer.invoke('setThreadOptions', threadRef, patch),
  fanOut: (threadRefs, prompt) => ipcRenderer.invoke('fanOut', threadRefs, prompt),
  startOrchestration: (opts) => ipcRenderer.invoke('startOrchestration', opts),
  listSchedules: () => ipcRenderer.invoke('listSchedules'),
  createSchedule: (input) => ipcRenderer.invoke('createSchedule', input),
  updateSchedule: (id, patch) => ipcRenderer.invoke('updateSchedule', id, patch),
  deleteSchedule: (id) => ipcRenderer.invoke('deleteSchedule', id),
  runSchedule: (id) => ipcRenderer.invoke('runSchedule', id),
  onSchedulesChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('schedules:changed', handler);
    return () => {
      ipcRenderer.removeListener('schedules:changed', handler);
    };
  },
  createGlobalChat: (opts) => ipcRenderer.invoke('createGlobalChat', opts),
  ensureCloudCoordinator: (agent) =>
    ipcRenderer.invoke('ensureCloudCoordinator', agent),
  stopThread: (threadRef) => ipcRenderer.invoke('stopThread', threadRef),
  getDiff: (threadRef, opts) => ipcRenderer.invoke('getDiff', threadRef, opts),
  initializeGit: (threadRef) => ipcRenderer.invoke('initializeGit', threadRef),
  getPrChecks: (threadRef) => ipcRenderer.invoke('getPrChecks', threadRef),
  getPrMeta: (threadRef) => ipcRenderer.invoke('getPrMeta', threadRef),
  getPrStack: (threadRef) => ipcRenderer.invoke('getPrStack', threadRef),
  openPrStackLayers: (threadRef, opts) =>
    ipcRenderer.invoke('openPrStackLayers', threadRef, opts),
  addStackLayer: (threadRef, branchName, opts) =>
    ipcRenderer.invoke('addStackLayer', threadRef, branchName, opts),
  initStackFromThread: (threadRef, opts) =>
    ipcRenderer.invoke('initStackFromThread', threadRef, opts),
  createPrStack: (input) => ipcRenderer.invoke('createPrStack', input),
  getPrDetails: (threadRef) => ipcRenderer.invoke('getPrDetails', threadRef),
  listFiles: (threadRef) => ipcRenderer.invoke('listFiles', threadRef),
  readFile: (threadRef, relativePath) =>
    ipcRenderer.invoke('readFile', threadRef, relativePath),
  readFileForUpload: (threadRef, relativePath) =>
    ipcRenderer.invoke('readFileForUpload', threadRef, relativePath),
  writeFile: (threadRef, relativePath, content) =>
    ipcRenderer.invoke('writeFile', threadRef, relativePath, content),
  watchOpenFile: (threadRef, relativePath) =>
    ipcRenderer.invoke('watchOpenFile', threadRef, relativePath),
  unwatchOpenFile: () => ipcRenderer.invoke('unwatchOpenFile'),
  onOpenFileChanged: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { threadRef: string; path: string },
    ) => listener(payload);
    ipcRenderer.on('file:changed', handler);
    return () => {
      ipcRenderer.removeListener('file:changed', handler);
    };
  },
  listSkills: (threadRef) => ipcRenderer.invoke('listSkills', threadRef),
  openInEditor: (threadRef, editor, relativePath) =>
    ipcRenderer.invoke('openInEditor', threadRef, editor, relativePath),
  openWorktree: (threadRef, target) => ipcRenderer.invoke('openWorktree', threadRef, target),
  runDevScript: (threadRef, scriptName) =>
    ipcRenderer.invoke('runDevScript', threadRef, scriptName),
  stopDevScript: (threadRef, scriptName) =>
    ipcRenderer.invoke('stopDevScript', threadRef, scriptName),
  listRunScripts: (threadRef) => ipcRenderer.invoke('listRunScripts', threadRef),
  getActiveRuns: (threadRef) => ipcRenderer.invoke('getActiveRuns', threadRef),
  previewLand: (threadRef) => ipcRenderer.invoke('previewLand', threadRef),
  confirmLand: (threadRef, opts) => ipcRenderer.invoke('confirmLand', threadRef, opts),
  markPrReady: (threadRef) => ipcRenderer.invoke('markPrReady', threadRef),
  mergePr: (threadRef) => ipcRenderer.invoke('mergePr', threadRef),
  askGit: (threadRef, action) => ipcRenderer.invoke('askGit', threadRef, action),
  archiveThread: (threadRef) => ipcRenderer.invoke('archiveThread', threadRef),
  purgeThread: (threadRef, opts) => ipcRenderer.invoke('purgeThread', threadRef, opts),
  restoreThread: (threadRef) => ipcRenderer.invoke('restoreThread', threadRef),
  applyIntoMain: (threadRef, opts) => ipcRenderer.invoke('applyIntoMain', threadRef, opts),
  cloneRepo: (url, name) => ipcRenderer.invoke('cloneRepo', url, name),
  listOrphanWorktrees: (repoPath) => ipcRenderer.invoke('listOrphanWorktrees', repoPath),
  cleanupOrphans: (opts) => ipcRenderer.invoke('cleanupOrphans', opts),
  bestOfN: (opts) => ipcRenderer.invoke('bestOfN', opts),
  attachThread: (threadRef) => ipcRenderer.invoke('attachThread', threadRef),
  terminal: {
    start: (threadRef, cols, rows) =>
      ipcRenderer.invoke('terminal:start', threadRef, cols, rows),
    attach: (threadRef, cols, rows) =>
      ipcRenderer.invoke('terminal:attach', threadRef, cols, rows),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    onData: (listener) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: { id: string; data: string },
      ) => listener(payload);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (listener) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: { id: string; exitCode: number | null },
      ) => listener(payload);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },
  getRepoPath: () => ipcRenderer.invoke('getRepoPath'),
  setRepoPath: (path) => ipcRenderer.invoke('setRepoPath', path),
  pickRepoPath: () => ipcRenderer.invoke('pickRepoPath'),
  pickFiles: (threadRef) => ipcRenderer.invoke('pickFiles', threadRef ?? null),
  attachmentsFromPaths: (absolutePaths) =>
    ipcRenderer.invoke('attachmentsFromPaths', absolutePaths),
  attachmentsFromBuffers: (buffers) =>
    ipcRenderer.invoke('attachmentsFromBuffers', buffers),
  hasConductorHook: (worktreePath, repoPath) =>
    ipcRenderer.invoke('hasConductorHook', worktreePath, repoPath),
  getRepoSetupInfo: (worktreePath, repoPath) =>
    ipcRenderer.invoke('getRepoSetupInfo', worktreePath, repoPath),
  runSetup: (threadRef) => ipcRenderer.invoke('runSetup', threadRef),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  publishArtifactPreview: (id, html) =>
    ipcRenderer.invoke('artifactPreview:publish', id, html),
  clearArtifactPreview: (id) => ipcRenderer.invoke('artifactPreview:clear', id),
  urlPreview: {
    show: (opts) => ipcRenderer.invoke('urlPreview:show', opts),
    setBounds: (bounds) => ipcRenderer.invoke('urlPreview:setBounds', bounds),
    navigate: (url) => ipcRenderer.invoke('urlPreview:navigate', url),
    reload: () => ipcRenderer.invoke('urlPreview:reload'),
    hide: () => ipcRenderer.invoke('urlPreview:hide'),
    onNavigated: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: { url: string }) =>
        listener(payload);
      ipcRenderer.on('url-preview:navigated', handler);
      return () => {
        ipcRenderer.removeListener('url-preview:navigated', handler);
      };
    },
  },
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: OrchestratorEvent) => listener(payload);
    ipcRenderer.on('orchestrator:event', handler);
    return () => {
      ipcRenderer.removeListener('orchestrator:event', handler);
    };
  },
  onThreadsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('threads:changed', handler);
    return () => {
      ipcRenderer.removeListener('threads:changed', handler);
    };
  },
  tsserver: {
    start: (worktreePath) => ipcRenderer.invoke('tsserver:start', worktreePath),
    stop: () => ipcRenderer.invoke('tsserver:stop'),
    isRunning: () => ipcRenderer.invoke('tsserver:is-running'),
    openFile: (absPath, content) => ipcRenderer.invoke('tsserver:open-file', absPath, content),
    closeFile: (absPath) => ipcRenderer.invoke('tsserver:close-file', absPath),
    updateFile: (absPath, content) => ipcRenderer.invoke('tsserver:update-file', absPath, content),
    diagnostics: (absPath) => ipcRenderer.invoke('tsserver:diagnostics', absPath),
    onMessage: (listener) => {
      const handler = (_event: IpcRendererEvent, message: unknown) => listener(message);
      ipcRenderer.on('tsserver:message', handler);
      return () => {
        ipcRenderer.removeListener('tsserver:message', handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('sideboard', api);

contextBridge.exposeInMainWorld('sideboardUpdate', {
  onAvailable: (listener: (info: { version: string }) => void) => {
    const handler = (_event: IpcRendererEvent, info: { version: string }) => listener(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onReady: (listener: (info: { version: string }) => void) => {
    const handler = (_event: IpcRendererEvent, info: { version: string }) => listener(info);
    ipcRenderer.on('update:ready', handler);
    return () => ipcRenderer.removeListener('update:ready', handler);
  },
  onError: (listener: (info: { message: string }) => void) => {
    const handler = (_event: IpcRendererEvent, info: { message: string }) => listener(info);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
  install: () => ipcRenderer.invoke('installUpdate') as Promise<void>,
  check: () => ipcRenderer.invoke('checkForUpdates') as Promise<void>,
  getVersion: () => ipcRenderer.invoke('getAppVersion') as Promise<string>,
  onOpenSettings: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('menu:open-settings', handler);
    return () => ipcRenderer.removeListener('menu:open-settings', handler);
  },
});
