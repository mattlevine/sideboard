import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcApi, OrchestratorEvent } from '@sideboard/core';

const api: IpcApi = {
  detectAgents: () => ipcRenderer.invoke('detectAgents'),
  listBranches: (repoPath) => ipcRenderer.invoke('listBranches', repoPath),
  listPrs: (repoPath) => ipcRenderer.invoke('listPrs', repoPath),
  listLinearIssues: (agent, repoPath) => ipcRenderer.invoke('listLinearIssues', agent, repoPath),
  resolveRepoRoot: (cwd) => ipcRenderer.invoke('resolveRepoRoot', cwd),
  getThreads: (includeArchived) => ipcRenderer.invoke('getThreads', includeArchived),
  getThread: (idOrRef) => ipcRenderer.invoke('getThread', idOrRef),
  createThread: (input) => ipcRenderer.invoke('createThread', input),
  adopt: (input) => ipcRenderer.invoke('adopt', input),
  listConductor: () => ipcRenderer.invoke('listConductor'),
  adoptFromConductor: (workspaceId) => ipcRenderer.invoke('adoptFromConductor', workspaceId),
  sendToThread: (threadRef, prompt) => ipcRenderer.invoke('sendToThread', threadRef, prompt),
  fanOut: (threadRefs, prompt) => ipcRenderer.invoke('fanOut', threadRefs, prompt),
  startOrchestration: (opts) => ipcRenderer.invoke('startOrchestration', opts),
  stopThread: (threadRef) => ipcRenderer.invoke('stopThread', threadRef),
  getDiff: (threadRef) => ipcRenderer.invoke('getDiff', threadRef),
  openInEditor: (threadRef, editor) => ipcRenderer.invoke('openInEditor', threadRef, editor),
  runDevScript: (threadRef) => ipcRenderer.invoke('runDevScript', threadRef),
  stopDevScript: (threadRef) => ipcRenderer.invoke('stopDevScript', threadRef),
  previewLand: (threadRef) => ipcRenderer.invoke('previewLand', threadRef),
  confirmLand: (threadRef) => ipcRenderer.invoke('confirmLand', threadRef),
  archiveThread: (threadRef) => ipcRenderer.invoke('archiveThread', threadRef),
  purgeThread: (threadRef, opts) => ipcRenderer.invoke('purgeThread', threadRef, opts),
  restoreThread: (threadRef) => ipcRenderer.invoke('restoreThread', threadRef),
  getRepoPath: () => ipcRenderer.invoke('getRepoPath'),
  setRepoPath: (path) => ipcRenderer.invoke('setRepoPath', path),
  pickRepoPath: () => ipcRenderer.invoke('pickRepoPath'),
  hasConductorHook: (repoPath) => ipcRenderer.invoke('hasConductorHook', repoPath),
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
