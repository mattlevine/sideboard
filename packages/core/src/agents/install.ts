import { run } from '../git/run.js';
import type { AgentKind } from '../types/thread.js';
import { ensureAgentPath } from './path.js';

export type AgentSetupKind = 'cli' | 'api-key' | 'bundled-sdk';

export interface AgentSetupInfo {
  agent: AgentKind;
  kind: AgentSetupKind;
  /** Short explanation for Settings. */
  summary: string;
  docsUrl: string;
  /** Shell one-liner to install the CLI (null when not applicable). */
  installCommand: string | null;
  /** Shell one-liner for interactive login/auth (null when API-key only). */
  loginCommand: string | null;
  /** npm package for in-app `npm i -g` when install is npm-based. */
  npmPackage?: string;
}

export interface AgentSetupActionResult {
  ok: boolean;
  /** True when a system Terminal window was opened for an interactive command. */
  openedTerminal?: boolean;
  command?: string;
  message: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

const SETUP: Record<AgentKind, AgentSetupInfo> = {
  claude: {
    agent: 'claude',
    kind: 'cli',
    summary: 'Install the Claude Code CLI, then complete login in a terminal.',
    docsUrl: 'https://code.claude.com/docs/en/install',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    npmPackage: '@anthropic-ai/claude-code',
  },
  codex: {
    agent: 'codex',
    kind: 'cli',
    summary: 'Install the Codex CLI, then run login in a terminal.',
    docsUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    npmPackage: '@openai/codex',
  },
  opencode: {
    agent: 'opencode',
    kind: 'cli',
    summary: 'Install OpenCode (curl installer or npm), then authenticate providers.',
    docsUrl: 'https://opencode.ai/docs',
    // Prefer the official installer; npm package name is opencode-ai.
    installCommand: 'curl -fsSL https://opencode.ai/install | bash',
    loginCommand: 'opencode auth login',
    npmPackage: 'opencode-ai@latest',
  },
  cursor: {
    agent: 'cursor',
    kind: 'bundled-sdk',
    summary:
      'No CLI install — Sideboard ships the Cursor SDK. Add a CURSOR_API_KEY from the Cursor dashboard.',
    docsUrl: 'https://cursor.com/dashboard/integrations',
    installCommand: null,
    loginCommand: null,
  },
  brightsy: {
    agent: 'brightsy',
    kind: 'cli',
    summary: 'Install the Brightsy CLI, then run `brightsy login`.',
    docsUrl: 'https://www.npmjs.com/package/@brightsy/cli',
    installCommand: 'npm install -g @brightsy/cli',
    loginCommand: 'brightsy login',
    npmPackage: '@brightsy/cli',
  },
};

export function getAgentSetupInfo(agent: AgentKind): AgentSetupInfo {
  return SETUP[agent];
}

export function listAgentSetupInfo(): AgentSetupInfo[] {
  return Object.values(SETUP);
}

/**
 * Open an interactive shell command in the system terminal (macOS Terminal.app,
 * Linux gnome-terminal/x-terminal-emulator, Windows cmd).
 */
export async function openInSystemTerminal(command: string): Promise<void> {
  ensureAgentPath();
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Command is empty');

  if (process.platform === 'darwin') {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Terminal" to do script "${escaped}"`;
    const result = await run('osascript', ['-e', script], { reject: false });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to open Terminal');
    }
    await run('osascript', ['-e', 'tell application "Terminal" to activate'], {
      reject: false,
    });
    return;
  }

  if (process.platform === 'win32') {
    // `start` is a cmd builtin — run via cmd.exe.
    const result = await run(
      'cmd.exe',
      ['/c', 'start', 'cmd.exe', '/k', trimmed],
      { reject: false },
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to open cmd');
    }
    return;
  }

  // Linux: try common terminals.
  const candidates: Array<{ file: string; args: string[] }> = [
    { file: 'gnome-terminal', args: ['--', 'bash', '-lc', `${trimmed}; exec bash`] },
    { file: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${trimmed}; exec bash`] },
    { file: 'konsole', args: ['-e', 'bash', '-lc', `${trimmed}; exec bash`] },
    { file: 'xterm', args: ['-e', 'bash', '-lc', `${trimmed}; exec bash`] },
  ];
  for (const c of candidates) {
    const which = await run('which', [c.file], { reject: false });
    if (which.exitCode !== 0 || !which.stdout.trim()) continue;
    const result = await run(c.file, c.args, { reject: false });
    if (result.exitCode === 0) return;
  }
  throw new Error(
    `No terminal found to run: ${trimmed}. Install gnome-terminal (or similar), or run the command manually.`,
  );
}

/** Install a CLI agent: npm packages run in-process; curl installers open Terminal. */
export async function installAgent(agent: AgentKind): Promise<AgentSetupActionResult> {
  const info = getAgentSetupInfo(agent);
  if (info.kind === 'bundled-sdk' || info.kind === 'api-key') {
    return {
      ok: true,
      message: info.summary,
    };
  }
  if (!info.installCommand) {
    return { ok: false, message: `No install command for ${agent}` };
  }

  // Curl / bash installers need a real TTY — open Terminal.
  if (/curl\s| \|\s*bash/.test(info.installCommand) || !info.npmPackage) {
    await openInSystemTerminal(info.installCommand);
    return {
      ok: true,
      openedTerminal: true,
      command: info.installCommand,
      message: `Opened Terminal to run: ${info.installCommand}`,
    };
  }

  ensureAgentPath();
  const result = await run('npm', ['install', '-g', info.npmPackage], { reject: false });
  const ok = result.exitCode === 0;
  if (!ok) {
    // Fall back to Terminal so the user can see interactive npm errors / sudo prompts.
    try {
      await openInSystemTerminal(info.installCommand);
      return {
        ok: false,
        openedTerminal: true,
        command: info.installCommand,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        message:
          `npm install failed (exit ${result.exitCode}). Opened Terminal with: ${info.installCommand}`,
      };
    } catch {
      return {
        ok: false,
        command: info.installCommand,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        message:
          result.stderr.trim() ||
          result.stdout.trim() ||
          `npm install failed (exit ${result.exitCode})`,
      };
    }
  }
  return {
    ok: true,
    command: info.installCommand,
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
    message: `Installed ${info.npmPackage}`,
  };
}

/** Open the agent’s login/auth command in the system terminal. */
export async function loginAgent(agent: AgentKind): Promise<AgentSetupActionResult> {
  const info = getAgentSetupInfo(agent);
  if (!info.loginCommand) {
    return {
      ok: true,
      message:
        info.kind === 'bundled-sdk' || info.kind === 'api-key'
          ? info.summary
          : `No login command for ${agent}`,
    };
  }
  await openInSystemTerminal(info.loginCommand);
  return {
    ok: true,
    openedTerminal: true,
    command: info.loginCommand,
    message: `Opened Terminal to run: ${info.loginCommand}`,
  };
}
