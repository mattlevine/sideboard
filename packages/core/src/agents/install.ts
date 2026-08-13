import { run } from '../git/run.js';
import {
  resolveAgentExecutable,
  type CliAgentKind,
} from '../store/app-settings.js';
import type { AgentKind } from '../types/thread.js';
import {
  enrichPathWithNpmGlobalBin,
  resolveCommandBinarySync,
  withExportedPath,
} from './path.js';

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

const CLI_BIN: Record<Exclude<AgentKind, 'cursor'>, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  brightsy: 'brightsy',
};

export function getAgentSetupInfo(agent: AgentKind): AgentSetupInfo {
  return SETUP[agent];
}

export function listAgentSetupInfo(): AgentSetupInfo[] {
  return Object.values(SETUP);
}

const CLI_LOGIN_AGENTS = new Set<AgentKind>([
  'claude',
  'codex',
  'opencode',
  'brightsy',
]);

/** Rewrite login command to honor a custom executable path override. */
export function resolveLoginCommand(agent: AgentKind): string | null {
  const info = getAgentSetupInfo(agent);
  if (!info.loginCommand) return null;
  if (!CLI_LOGIN_AGENTS.has(agent)) return info.loginCommand;
  const exe = resolveAgentExecutable(agent as CliAgentKind);
  return info.loginCommand.replace(/^\S+/, exe);
}

/**
 * Make a Terminal command resolve the same binaries Electron sees after
 * `npm i -g` (absolute path + exported PATH). Avoids "codex: command not found"
 * when Terminal’s login shell lacks the npm global bin.
 */
export async function prepareTerminalCommand(command: string): Promise<string> {
  enrichPathWithNpmGlobalBin();
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (/^(export\s+PATH=|PATH=)/.test(trimmed)) return trimmed;

  const match = /^(\S+)(\s[\s\S]*)?$/.exec(trimmed);
  const bin = match?.[1];
  let whichPath: string | null = null;
  if (bin && !bin.includes('/') && !bin.includes('\\')) {
    const which = await run('which', [bin], { reject: false, timeoutMs: 3_000 });
    whichPath = which.exitCode === 0 ? which.stdout.trim() : null;
  }
  const resolved = resolveCommandBinarySync(trimmed, whichPath);
  return withExportedPath(resolved, process.env.PATH ?? '');
}

/**
 * Open an interactive shell command in the system terminal (macOS Terminal.app,
 * Linux gnome-terminal/x-terminal-emulator, Windows cmd).
 */
export async function openInSystemTerminal(command: string): Promise<void> {
  const trimmed = (await prepareTerminalCommand(command)).trim();
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

  enrichPathWithNpmGlobalBin();
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

  // Refresh PATH and confirm the CLI resolves where Terminal will look.
  enrichPathWithNpmGlobalBin();
  const cliBin = agent === 'cursor' ? null : CLI_BIN[agent];
  let binPath: string | null = null;
  if (cliBin) {
    const which = await run('which', [cliBin], { reject: false, timeoutMs: 3_000 });
    binPath = which.exitCode === 0 ? which.stdout.trim().split(/\r?\n/).find(Boolean) ?? null : null;
  }

  return {
    ok: true,
    command: info.installCommand,
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
    message: binPath
      ? `Installed ${info.npmPackage} → ${binPath}`
      : `Installed ${info.npmPackage} (CLI not yet on PATH — Log in still exports Electron’s PATH into Terminal)`,
  };
}

/** Open the agent’s login/auth command in the system terminal. */
export async function loginAgent(agent: AgentKind): Promise<AgentSetupActionResult> {
  const info = getAgentSetupInfo(agent);
  const loginCommand = resolveLoginCommand(agent);
  if (!loginCommand) {
    return {
      ok: true,
      message:
        info.kind === 'bundled-sdk' || info.kind === 'api-key'
          ? info.summary
          : `No login command for ${agent}`,
    };
  }
  // prepareTerminalCommand runs inside openInSystemTerminal; keep the prepared
  // string for the UI log so users can see the absolute path.
  const prepared = await prepareTerminalCommand(loginCommand);
  // Already prepared — openInSystemTerminal would wrap again; pass through with
  // a PATH= prefix so prepareTerminalCommand is a no-op on the second pass.
  await openInSystemTerminal(prepared);
  return {
    ok: true,
    openedTerminal: true,
    command: prepared,
    message: `Opened Terminal to run: ${prepared}`,
  };
}
