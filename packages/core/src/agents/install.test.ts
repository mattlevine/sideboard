import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();

vi.mock('../git/run.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
}));

vi.mock('./path.js', () => ({
  ensureAgentPath: () => '/usr/bin',
}));

describe('agent install helpers', () => {
  beforeEach(() => {
    runMock.mockReset();
  });

  it('describes Cursor as a bundled SDK (no CLI install)', async () => {
    const { getAgentSetupInfo } = await import('./install.js');
    const info = getAgentSetupInfo('cursor');
    expect(info.kind).toBe('bundled-sdk');
    expect(info.installCommand).toBeNull();
    expect(info.loginCommand).toBeNull();
  });

  it('installs Codex via npm when available', async () => {
    runMock.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
    const { installAgent } = await import('./install.js');
    const result = await installAgent('codex');
    expect(result.ok).toBe(true);
    expect(runMock).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', '@openai/codex'],
      expect.objectContaining({ reject: false }),
    );
  });

  it('opens Terminal for login commands', async () => {
    runMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const { loginAgent } = await import('./install.js');
    const result = await loginAgent('claude');
    expect(result.ok).toBe(true);
    expect(result.openedTerminal).toBe(true);
    expect(result.command).toBe('claude auth login');
  });
});
