import { ipcMain, type BrowserWindow } from 'electron';
import { TsServerManager } from './TsServerManager';

let tsServerManager: TsServerManager | null = null;
let handlersRegistered = false;

export function setupTsServer(window: BrowserWindow): void {
  if (!tsServerManager) {
    tsServerManager = new TsServerManager(window);
  } else {
    tsServerManager.setWindow(window);
  }

  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('tsserver:start', async (_e, worktreePath?: string) => {
    try {
      if (!tsServerManager) throw new Error('TsServerManager not initialized');
      await tsServerManager.start(worktreePath);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[IPC] tsserver:start failed:', message);
      return { success: false as const, error: message };
    }
  });

  ipcMain.handle('tsserver:stop', async () => {
    try {
      await tsServerManager?.stop();
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  });

  ipcMain.handle('tsserver:is-running', () => tsServerManager?.isRunning() ?? false);

  ipcMain.handle('tsserver:open-file', (_e, filePath: string, fileContent?: string) => {
    if (!tsServerManager?.isRunning()) {
      return { success: false as const, error: 'tsserver not running' };
    }
    try {
      tsServerManager.openFile(filePath, fileContent);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  });

  ipcMain.handle('tsserver:close-file', (_e, filePath: string) => {
    if (!tsServerManager?.isRunning()) {
      return { success: false as const, error: 'tsserver not running' };
    }
    try {
      tsServerManager.closeFile(filePath);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  });

  ipcMain.handle('tsserver:update-file', (_e, filePath: string, content: string) => {
    if (!tsServerManager?.isRunning()) {
      return { success: false as const, error: 'tsserver not running' };
    }
    try {
      tsServerManager.updateFile(filePath, content);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  });

  ipcMain.handle('tsserver:diagnostics', (_e, filePath: string) => {
    if (!tsServerManager?.isRunning()) {
      return { success: false as const, error: 'tsserver not running' };
    }
    try {
      tsServerManager.requestDiagnostics(filePath, 0);
      const semanticSeq = tsServerManager.getSemanticDiagnostics(filePath);
      const syntacticSeq = tsServerManager.getSyntacticDiagnostics(filePath);
      return { success: true as const, semanticSeq, syntacticSeq };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  });
}

export async function closeTsServer(): Promise<void> {
  if (tsServerManager) {
    await tsServerManager.stop();
    tsServerManager = null;
  }
}
