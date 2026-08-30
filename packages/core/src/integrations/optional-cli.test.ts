import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMock = vi.fn();

vi.mock('../git/run.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
}));

vi.mock('../agents/path.js', () => ({
  enrichPathWithNpmGlobalBin: () => '/opt/homebrew/bin:/usr/bin',
  isConductorBundledCli: () => false,
  resolveCommandBinarySync: (command: string) => command,
  withExportedPath: (command: string, pathValue: string) =>
    `export PATH='${pathValue}'; ${command}`,
}));

describe('optional connector CLI install', () => {
  beforeEach(() => {
    runMock.mockReset();
  });

  it('detects vercel on PATH and leaves PostHog without a CLI', async () => {
    runMock.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'which' && args[0] === 'vercel') {
        return { stdout: '/opt/homebrew/bin/vercel\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });
    const { detectOptionalServiceClis } = await import('./optional-cli.js');
    const statuses = await detectOptionalServiceClis();
    expect(statuses.find((s) => s.id === 'vercel')).toEqual({
      id: 'vercel',
      cli: 'vercel',
      installed: true,
      path: '/opt/homebrew/bin/vercel',
    });
    expect(statuses.find((s) => s.id === 'posthog')).toEqual({
      id: 'posthog',
      cli: null,
      installed: false,
      path: null,
    });
    expect(statuses.find((s) => s.id === 'supabase')?.installed).toBe(false);
  });

  it('refuses to install PostHog', async () => {
    const { installOptionalServiceCli } = await import('./optional-cli.js');
    const result = await installOptionalServiceCli('posthog');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no CLI to install/);
    expect(runMock).not.toHaveBeenCalledWith(
      'npm',
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips npm when vercel is already on PATH', async () => {
    runMock.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'which' && args[0] === 'vercel') {
        return { stdout: '/opt/homebrew/bin/vercel\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const { installOptionalServiceCli } = await import('./optional-cli.js');
    const result = await installOptionalServiceCli('vercel');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('/opt/homebrew/bin/vercel');
    expect(runMock).not.toHaveBeenCalledWith(
      'npm',
      expect.anything(),
      expect.anything(),
    );
  });

  it('installs sentry-cli via npm when missing', async () => {
    let installed = false;
    runMock.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'npm') {
        installed = true;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      }
      if (file === 'which' && args[0] === 'sentry-cli') {
        return installed
          ? { stdout: '/opt/homebrew/bin/sentry-cli\n', stderr: '', exitCode: 0 }
          : { stdout: '', stderr: '', exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const { installOptionalServiceCli } = await import('./optional-cli.js');
    const result = await installOptionalServiceCli('sentry');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('/opt/homebrew/bin/sentry-cli');
    expect(runMock).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', '@sentry/cli'],
      expect.objectContaining({ reject: false }),
    );
  });
});
