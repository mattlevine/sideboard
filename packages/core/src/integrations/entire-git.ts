import { openInSystemTerminal, type AgentSetupActionResult } from '../agents/install.js';
import { run } from '../git/run.js';

export interface EntireGitStatus {
  installed: boolean;
  connected: boolean;
  /** Handle from the active `entire auth contexts` row. */
  account: string | null;
  reason: string | null;
}

/**
 * Read the active login from `entire auth contexts`.
 * The table is local and has no network call. The active row ends with `(active)`.
 */
export function parseEntireAuthContexts(text: string): { account: string | null } {
  for (const line of text.split('\n')) {
    if (!/\(active\)/i.test(line)) continue;
    const cols = line
      .replace(/\(active\)/gi, '')
      .trim()
      .split(/\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const handle = cols[1] || cols[0] || null;
    if (handle && !/^context$/i.test(handle)) return { account: handle };
  }
  return { account: null };
}

/**
 * This Mac’s Entire CLI login. Entire git repos (`entire://`, `*.entire.io`)
 * use `entire` the way GitHub repos use `gh` and Cursor repos use `origin`.
 */
export async function getEntireGitStatus(): Promise<EntireGitStatus> {
  const which = await run('which', ['entire'], { reject: false, timeoutMs: 5_000 });
  if (which.exitCode !== 0 || !which.stdout.trim()) {
    return {
      installed: false,
      connected: false,
      account: null,
      reason: 'entire CLI not found on PATH',
    };
  }

  const status = await run('entire', ['auth', 'contexts'], { reject: false, timeoutMs: 15_000 });
  const parsed = parseEntireAuthContexts(status.stdout);
  if (status.exitCode === 0 && parsed.account) {
    return {
      installed: true,
      connected: true,
      account: parsed.account,
      reason: null,
    };
  }

  return {
    installed: true,
    connected: false,
    account: null,
    reason:
      status.stderr.trim() ||
      'Not signed in to Entire (Settings → Git → Entire, or entire login)',
  };
}

/** Open `entire login` in Terminal. Browser sign-in cannot finish headless. */
export async function loginEntireGit(): Promise<AgentSetupActionResult> {
  const status = await getEntireGitStatus();
  if (!status.installed) {
    return { ok: false, message: status.reason || 'entire CLI not found on PATH' };
  }
  await openInSystemTerminal('entire login');
  return {
    ok: true,
    openedTerminal: true,
    command: 'entire login',
    message: 'Opened Terminal to run: entire login',
  };
}
