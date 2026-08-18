import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../git/run.js', () => ({
  run: vi.fn(),
}));

import { run } from '../git/run.js';
import { applyNodeLaunch, isAsarPath, resolveNodeLaunch } from './node-launch.js';

const runMock = vi.mocked(run);

describe('isAsarPath', () => {
  it('detects electron asar script paths', () => {
    expect(
      isAsarPath(
        '/Apps/Sideboard.app/Contents/Resources/app.asar/node_modules/@sideboard-ai/core/dist/agents/cursor-runner.js',
      ),
    ).toBe(true);
    expect(isAsarPath('/tmp/packages/core/dist/agents/cursor-runner.js')).toBe(
      false,
    );
  });
});

describe('resolveNodeLaunch', () => {
  beforeEach(() => {
    runMock.mockReset();
  });

  it('uses Electron-as-Node for asar paths even when system node exists', async () => {
    const launch = await resolveNodeLaunch(
      '/Apps/Sideboard.app/Contents/Resources/app.asar/node_modules/x.js',
    );
    expect(launch.file).toBe(process.execPath);
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe('1');
    // Must not bother looking up system node for asar.
    expect(runMock).not.toHaveBeenCalled();
  });

  it('prefers system node for normal filesystem scripts', async () => {
    runMock.mockResolvedValueOnce({
      stdout: '/opt/homebrew/bin/node\n',
      stderr: '',
      exitCode: 0,
    });
    const launch = await resolveNodeLaunch(
      '/Users/me/sideboard/packages/core/dist/agents/cursor-runner.js',
    );
    expect(launch.file).toBe('/opt/homebrew/bin/node');
    expect(launch.env).toEqual({});
  });

  it('does not wrap system node', () => {
    const applied = applyNodeLaunch(
      { file: '/opt/homebrew/bin/node', env: {} },
      ['/tmp/run-stdio.js'],
    );
    expect(applied).toEqual({
      file: '/opt/homebrew/bin/node',
      args: ['/tmp/run-stdio.js'],
      env: {},
    });
  });

  it('wraps Electron-as-Node launches', () => {
    const applied = applyNodeLaunch(
      { file: '/Apps/Sideboard.app/MacOS/Sideboard', env: { ELECTRON_RUN_AS_NODE: '1' } },
      ['/tmp/run-stdio.js'],
    );
    if (process.platform === 'win32') {
      expect(applied.file).toBe('/Apps/Sideboard.app/MacOS/Sideboard');
      expect(applied.args).toEqual(['/tmp/run-stdio.js']);
      expect(applied.env.ELECTRON_RUN_AS_NODE).toBe('1');
      return;
    }
    expect(applied.file).toBe('/bin/sh');
    expect(applied.args).toContain('/Apps/Sideboard.app/MacOS/Sideboard');
    expect(applied.args.at(-1)).toBe('/tmp/run-stdio.js');
    expect(applied.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
