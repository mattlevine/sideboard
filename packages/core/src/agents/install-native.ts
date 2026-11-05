import { run } from '../git/run.js';
import {
  openInSystemTerminal,
  whichOnPath,
  type AgentSetupActionResult,
} from './install.js';

/**
 * Official installer. Does not need Node.
 * `npm i -g @anthropic-ai/claude-code` can exit 0 on a new Mac while leaving
 * `bin/claude.exe` as a mode-644 stub (optional native package not linked).
 * `/usr/bin/which` skips non-executable files, so Settings reported
 * "Installed (CLI not yet on PATH)" and Claude stayed unusable.
 * This script writes an executable `~/.local/bin/claude`.
 */
export const CLAUDE_NATIVE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';
export const OPENCODE_NATIVE_INSTALL = 'curl -fsSL https://opencode.ai/install | bash';

/**
 * Run a vendor curl|bash installer and require the CLI to show up on PATH.
 * Sideboard is macOS-only; these scripts write under the user home.
 */
async function installCurlScript(opts: {
  command: string;
  bin: string;
  label: string;
  expected: string;
}): Promise<AgentSetupActionResult> {
  const result = await run('bash', ['-c', opts.command], {
    reject: false,
    timeoutMs: 300_000,
  });
  if (result.exitCode === 0) {
    // `run` → ensureAgentPath picks up the new home bin dir once it exists.
    const binPath = await whichOnPath(opts.bin);
    if (binPath) {
      return {
        ok: true,
        command: opts.command,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        message: `Installed ${opts.label} → ${binPath}`,
      };
    }
    return {
      ok: false,
      command: opts.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      message: `${opts.label} installer finished, but \`${opts.bin}\` is not on PATH. Expected ${opts.expected}.`,
    };
  }

  const detail = result.stderr.trim() || result.stdout.trim();
  try {
    await openInSystemTerminal(opts.command);
    return {
      ok: false,
      openedTerminal: true,
      command: opts.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      message: `${opts.label} install failed (exit ${result.exitCode}). Opened Terminal with: ${opts.command}`,
    };
  } catch {
    return {
      ok: false,
      command: opts.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      message: detail
        ? `${opts.label} install failed (exit ${result.exitCode}). ${detail}`
        : `${opts.label} install failed (exit ${result.exitCode})`,
    };
  }
}

export function installClaudeNative(): Promise<AgentSetupActionResult> {
  return installCurlScript({
    command: CLAUDE_NATIVE_INSTALL,
    bin: 'claude',
    label: 'Claude Code',
    expected: '~/.local/bin/claude',
  });
}

export function installOpenCodeNative(): Promise<AgentSetupActionResult> {
  return installCurlScript({
    command: OPENCODE_NATIVE_INSTALL,
    bin: 'opencode',
    label: 'OpenCode',
    expected: '~/.opencode/bin/opencode',
  });
}
