import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
const exeOverrides: Partial<Record<string, string>> = {};

vi.mock('../git/run.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
}));

vi.mock('../store/app-settings.js', () => ({
  resolveAgentExecutable: (agent: string) => exeOverrides[agent] ?? agent,
}));

vi.mock('./path.js', () => ({
  ensureAgentPath: () => '/usr/bin',
  enrichPathWithNpmGlobalBin: () => '/opt/homebrew/bin:/usr/bin',
  resolveCommandBinarySync: (command: string, whichPath: string | null) => {
    const abs = whichPath?.trim().split(/\r?\n/).find(Boolean);
    if (abs) {
      const rest = command.replace(/^\S+/, '').trimStart();
      return rest ? `${abs} ${rest}` : abs;
    }
    return command;
  },
  withExportedPath: (command: string, pathValue: string) =>
    `export PATH='${pathValue}'; ${command}`,
}));

describe('agent install helpers', () => {
  beforeEach(() => {
    runMock.mockReset();
    for (const key of Object.keys(exeOverrides)) {
      delete exeOverrides[key];
    }
  });

  it('describes Cursor as a bundled SDK (no CLI install)', async () => {
    const { getAgentSetupInfo } = await import('./install.js');
    const info = getAgentSetupInfo('cursor');
    expect(info.kind).toBe('bundled-sdk');
    expect(info.installCommand).toBeNull();
    expect(info.loginCommand).toBeNull();
  });

  it('installs Codex via npm when available', async () => {
    runMock.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'npm') return { stdout: 'ok', stderr: '', exitCode: 0 };
      if (file === 'which' && args[0] === 'codex') {
        return { stdout: '/opt/homebrew/bin/codex\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const { installAgent } = await import('./install.js');
    const result = await installAgent('codex');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('/opt/homebrew/bin/codex');
    expect(runMock).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', '@openai/codex'],
      expect.objectContaining({ reject: false }),
    );
  });

  it('opens Terminal for login with absolute codex path + PATH export', async () => {
    runMock.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'which' && args[0] === 'codex') {
        return { stdout: '/opt/homebrew/bin/codex\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const { loginAgent } = await import('./install.js');
    const result = await loginAgent('codex');
    expect(result.ok).toBe(true);
    expect(result.openedTerminal).toBe(true);
    expect(result.command).toContain('/opt/homebrew/bin/codex login');
    expect(result.command).toMatch(/^export PATH=/);
    expect(runMock).toHaveBeenCalledWith(
      'osascript',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('/opt/homebrew/bin/codex login'),
      ]),
      expect.objectContaining({ reject: false }),
    );
  });

  it('rewrites login to a custom executable path override', async () => {
    exeOverrides.codex = '/Users/me/.local/bin/codex';
    runMock.mockImplementation(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const { resolveLoginCommand, loginAgent } = await import('./install.js');
    expect(resolveLoginCommand('codex')).toBe('/Users/me/.local/bin/codex login');
    const result = await loginAgent('codex');
    expect(result.command).toContain('/Users/me/.local/bin/codex login');
  });
});
