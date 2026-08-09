import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../git/run.js', () => ({
  run: vi.fn(),
}));

import { run } from '../git/run.js';
import { isAsarPath, resolveNodeLaunch } from './node-launch.js';

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
});
