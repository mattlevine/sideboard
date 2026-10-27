import type { AgentSetupActionResult } from '../agents/install.js';
import type { CursorGitStatus } from '../integrations/cursor-git.js';
import type { EntireGitStatus } from '../integrations/entire-git.js';

/** Settings → Git CLI login for Cursor (`origin`) and Entire (`entire`). */
export interface GitHostIpcApi {
  getCursorGitStatus(): Promise<CursorGitStatus>;
  loginCursorGit(): Promise<AgentSetupActionResult>;
  setupCursorGit(): Promise<AgentSetupActionResult>;
  getEntireGitStatus(): Promise<EntireGitStatus>;
  loginEntireGit(): Promise<AgentSetupActionResult>;
}
