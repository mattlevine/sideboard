import { ipcMain } from 'electron';
import {
  getCursorGitStatus,
  getEntireGitStatus,
  loginCursorGit,
  loginEntireGit,
  setupCursorGit,
} from '@sideboard-ai/core';

/** Cursor and Entire CLI login. Kept out of main/index.ts so that file stays under its line cap. */
export function registerGitHostIpc(): void {
  ipcMain.handle('getCursorGitStatus', () => getCursorGitStatus());
  ipcMain.handle('loginCursorGit', () => loginCursorGit());
  ipcMain.handle('setupCursorGit', () => setupCursorGit());
  ipcMain.handle('getEntireGitStatus', () => getEntireGitStatus());
  ipcMain.handle('loginEntireGit', () => loginEntireGit());
}
