import { openInSystemTerminal, type AgentSetupActionResult } from '../agents/install.js';
import { run } from '../git/run.js';

export interface CursorGitStatus {
  installed: boolean;
  connected: boolean;
  /** Account line from `origin auth status` (email and user id). */
  account: string | null;
  /** How Origin authenticated: api-key, login, or a token env var. */
  authMethod: string | null;
  reason: string | null;
}

/** Parse `origin auth status` text. Exported for tests. */
export function parseOriginAuthStatus(text: string): {
  account: string | null;
  authMethod: string | null;
} {
  const account = text.match(/^Account:\s+(.+)$/m)?.[1]?.trim() || null;
  const authMethod = text.match(/^Auth method:\s+(.+)$/m)?.[1]?.trim() || null;
  return { account, authMethod };
}

/**
 * This Mac’s Origin CLI login. Cursor git repos (`origin.cursor.com`) use
 * `origin` the way GitHub repos use `gh`.
 */
export async function getCursorGitStatus(): Promise<CursorGitStatus> {
  const which = await run('which', ['origin'], { reject: false, timeoutMs: 5_000 });
  if (which.exitCode !== 0 || !which.stdout.trim()) {
    return {
      installed: false,
      connected: false,
      account: null,
      authMethod: null,
      reason: 'origin CLI not found on PATH',
    };
  }

  const status = await run('origin', ['auth', 'status'], { reject: false, timeoutMs: 15_000 });
  const text = `${status.stdout}\n${status.stderr}`;
  const parsed = parseOriginAuthStatus(text);
  if (status.exitCode === 0 && parsed.account) {
    return {
      installed: true,
      connected: true,
      account: parsed.account,
      authMethod: parsed.authMethod,
      reason: null,
    };
  }

  return {
    installed: true,
    connected: false,
    account: null,
    authMethod: null,
    reason:
      status.stderr.trim() ||
      status.stdout.trim() ||
      'Not signed in to Cursor (Settings → Git → Cursor, or origin auth login)',
  };
}

/** Open `origin auth login` in Terminal. Browser sign-in cannot finish headless. */
export async function loginCursorGit(): Promise<AgentSetupActionResult> {
  const status = await getCursorGitStatus();
  if (!status.installed) {
    return { ok: false, message: status.reason || 'origin CLI not found on PATH' };
  }
  await openInSystemTerminal('origin auth login');
  return {
    ok: true,
    openedTerminal: true,
    command: 'origin auth login',
    message: 'Opened Terminal to run: origin auth login',
  };
}

/** `origin auth setup-git` so git push to origin.cursor.com uses the Origin CLI. */
export async function setupCursorGit(): Promise<AgentSetupActionResult> {
  const status = await getCursorGitStatus();
  if (!status.installed) {
    return { ok: false, message: status.reason || 'origin CLI not found on PATH' };
  }
  const result = await run('origin', ['auth', 'setup-git'], {
    reject: false,
    timeoutMs: 20_000,
  });
  const message =
    result.stdout.trim() ||
    result.stderr.trim() ||
    (result.exitCode === 0
      ? 'Git is configured to authenticate Origin through the origin CLI.'
      : 'origin auth setup-git failed');
  return {
    ok: result.exitCode === 0,
    command: 'origin auth setup-git',
    message,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}
