import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcApi, OrchestratorEvent } from '@sideboard/core';

const api: IpcApi = {
  detectAgents: () => ipcRenderer.invoke('detectAgents'),
  getAppSettings: () => ipcRenderer.invoke('getAppSettings'),
  saveAppSettings: (settings) => ipcRenderer.invoke('saveAppSettings', settings),
  updateAppEnvironment: (patch) => ipcRenderer.invoke('updateAppEnvironment', patch),
  updateClaudeSettings: (patch) => ipcRenderer.invoke('updateClaudeSettings', patch),
  pickClaudeExecutable: () => ipcRenderer.invoke('pickClaudeExecutable'),
  resolveSystemClaudePath: () => ipcRenderer.invoke('resolveSystemClaudePath'),
  openClaudeUserSettings: () => ipcRenderer.invoke('openClaudeUserSettings'),
  listBrightsyChatTargets: () => ipcRenderer.invoke('listBrightsyChatTargets'),
  getBrightsySession: () => ipcRenderer.invoke('getBrightsySession'),
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
  getGitHubStatus: () => ipcRenderer.invoke('getGitHubStatus'),
  listIssues: (repoPath) => ipcRenderer.invoke('listIssues', repoPath),
  listBranches: (repoPath) => ipcRenderer.invoke('listBranches', repoPath),
  listPrs: (repoPath) => ipcRenderer.invoke('listPrs', repoPath),
  listLinearIssues: (agent, repoPath) => ipcRenderer.invoke('listLinearIssues', agent, repoPath),
  resolveRepoRoot: (cwd) => ipcRenderer.invoke('resolveRepoRoot', cwd),
  getThreads: (includeArchived) => ipcRenderer.invoke('getThreads', includeArchived),
  getThread: (idOrRef) => ipcRenderer.invoke('getThread', idOrRef),
  getRuntime: () => ipcRenderer.invoke('getRuntime'),
  setMaxConcurrent: (n) => ipcRenderer.invoke('setMaxConcurrent', n),
  createThread: (input) => ipcRenderer.invoke('createThread', input),
  createChatTab: (input) => ipcRenderer.invoke('createChatTab', input),
  forkChatTab: (input) => ipcRenderer.invoke('forkChatTab', input),
  forkThreadWorktree: (input) => ipcRenderer.invoke('forkThreadWorktree', input),
  renameThread: (threadRef, title) => ipcRenderer.invoke('renameThread', threadRef, title),
  setAttachments: (threadRef, attachments) =>
    ipcRenderer.invoke('setAttachments', threadRef, attachments),
  listWorktreeChats: (threadRef) => ipcRenderer.invoke('listWorktreeChats', threadRef),
  listWorkspaces: () => ipcRenderer.invoke('listWorkspaces'),
  addWorkspace: (repoPath) => ipcRenderer.invoke('addWorkspace', repoPath),
  removeWorkspace: (repoPath) => ipcRenderer.invoke('removeWorkspace', repoPath),
  adopt: (input) => ipcRenderer.invoke('adopt', input),
  listConductor: () => ipcRenderer.invoke('listConductor'),
  adoptFromConductor: (workspaceId) => ipcRenderer.invoke('adoptFromConductor', workspaceId),
  sendToThread: (threadRef, prompt) => ipcRenderer.invoke('sendToThread', threadRef, prompt),
  setAutonomy: (threadRef, autonomy) => ipcRenderer.invoke('setAutonomy', threadRef, autonomy),
  setThreadOptions: (threadRef, patch) =>
    ipcRenderer.invoke('setThreadOptions', threadRef, patch),
  fanOut: (threadRefs, prompt) => ipcRenderer.invoke('fanOut', threadRefs, prompt),
  startOrchestration: (opts) => ipcRenderer.invoke('startOrchestration', opts),
  stopThread: (threadRef) => ipcRenderer.invoke('stopThread', threadRef),
  getDiff: (threadRef, opts) => ipcRenderer.invoke('getDiff', threadRef, opts),
  initializeGit: (threadRef) => ipcRenderer.invoke('initializeGit', threadRef),
  getPrChecks: (threadRef) => ipcRenderer.invoke('getPrChecks', threadRef),
  getPrDetails: (threadRef) => ipcRenderer.invoke('getPrDetails', threadRef),
  listFiles: (threadRef) => ipcRenderer.invoke('listFiles', threadRef),
  readFile: (threadRef, relativePath) =>
    ipcRenderer.invoke('readFile', threadRef, relativePath),
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
  runDevScript: (threadRef) => ipcRenderer.invoke('runDevScript', threadRef),
  stopDevScript: (threadRef) => ipcRenderer.invoke('stopDevScript', threadRef),
  previewLand: (threadRef) => ipcRenderer.invoke('previewLand', threadRef),
  confirmLand: (threadRef, opts) => ipcRenderer.invoke('confirmLand', threadRef, opts),
  archiveThread: (threadRef) => ipcRenderer.invoke('archiveThread', threadRef),
  purgeThread: (threadRef, opts) => ipcRenderer.invoke('purgeThread', threadRef, opts),
  restoreThread: (threadRef) => ipcRenderer.invoke('restoreThread', threadRef),
  getRepoPath: () => ipcRenderer.invoke('getRepoPath'),
  setRepoPath: (path) => ipcRenderer.invoke('setRepoPath', path),
  pickRepoPath: () => ipcRenderer.invoke('pickRepoPath'),
  pickFiles: () => ipcRenderer.invoke('pickFiles'),
  hasConductorHook: (worktreePath, repoPath) =>
    ipcRenderer.invoke('hasConductorHook', worktreePath, repoPath),
  getRepoSetupInfo: (worktreePath, repoPath) =>
    ipcRenderer.invoke('getRepoSetupInfo', worktreePath, repoPath),
  runSetup: (threadRef) => ipcRenderer.invoke('runSetup', threadRef),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
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
  onReady: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('update:ready', handler);
    return () => ipcRenderer.removeListener('update:ready', handler);
  },
  install: () => ipcRenderer.invoke('installUpdate') as Promise<void>,
});
