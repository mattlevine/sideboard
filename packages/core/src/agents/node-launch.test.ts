import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../git/run.js', () => ({
  run: vi.fn(),
}));

import { run } from '../git/run.js';
import {
  applyNodeLaunch,
  isAsarPath,
  nodeReadableScriptPath,
  pickPreferredNodeBin,
  resolveNodeLaunch,
  scoreNodeForAgentRuntime,
} from './node-launch.js';

const runMock = vi.mocked(run);

function mockNodeLookups(bin: string, version = 'v22.14.0'): void {
  runMock.mockImplementation(async (file, args) => {
    if (file === 'which' || file === 'where') {
      return { stdout: `${bin}\n`, stderr: '', exitCode: 0 };
    }
    if (args?.[0] === '-v') {
      const v = file.includes('node@23') || file.includes('/Cellar/node/23') ? 'v23.6.0' : version;
      return { stdout: `${v}\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 1 };
  });
}

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

  it('does not treat app.asar.unpacked as asar', () => {
    expect(
      isAsarPath(
        '/Apps/Sideboard.app/Contents/Resources/app.asar.unpacked/node_modules/x.js',
      ),
    ).toBe(false);
  });
});

describe('scoreNodeForAgentRuntime', () => {
  it('prefers even LTS ≥20 over odd Current', () => {
    expect(
      scoreNodeForAgentRuntime({ path: '/opt/homebrew/opt/node@22/bin/node', version: 'v22.14.0' }),
    ).toBeGreaterThan(
      scoreNodeForAgentRuntime({ path: '/opt/homebrew/bin/node', version: 'v23.6.0' }),
    );
    expect(
      pickPreferredNodeBin([
        { path: '/opt/homebrew/bin/node', version: 'v23.6.0' },
        { path: '/opt/homebrew/opt/node@22/bin/node', version: 'v22.14.0' },
      ]),
    ).toBe('/opt/homebrew/opt/node@22/bin/node');
  });

  it('scores by probed version, not keg name', () => {
    const aliased = scoreNodeForAgentRuntime({
      path: '/opt/homebrew/opt/node@22/bin/node',
      version: 'v23.6.0',
    });
    const realLts = scoreNodeForAgentRuntime({
      path: '/usr/local/bin/node',
      version: 'v22.14.0',
    });
    expect(realLts).toBeGreaterThan(aliased);
  });

  it('rejects Node <20 below engines', () => {
    expect(
      scoreNodeForAgentRuntime({ path: '/usr/local/bin/node', version: 'v18.20.0' }),
    ).toBeLessThan(
      scoreNodeForAgentRuntime({ path: '/opt/homebrew/bin/node', version: 'v23.6.0' }),
    );
  });
});

describe('resolveNodeLaunch', () => {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  const previousResources = proc.resourcesPath;

  beforeEach(() => {
    runMock.mockReset();
  });

  afterEach(() => {
    if (previousResources === undefined) delete proc.resourcesPath;
    else proc.resourcesPath = previousResources;
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

  it('prefers system node for asar.unpacked scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-asar-'));
    try {
      const unpacked = join(root, 'app.asar.unpacked', 'node_modules');
      mkdirSync(unpacked, { recursive: true });
      const script = join(unpacked, 'x.js');
      writeFileSync(script, '');
      mockNodeLookups(process.execPath);
      const asarScript = join(root, 'app.asar', 'node_modules', 'x.js');
      expect(nodeReadableScriptPath(asarScript)).toBe(script);
      const launch = await resolveNodeLaunch(asarScript);
      expect(launch.file).toBe(process.execPath);
      expect(launch.env).toEqual({});
      const applied = applyNodeLaunch(launch, [asarScript]);
      expect(applied.args).toEqual([script]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers system node for normal filesystem scripts', async () => {
    mockNodeLookups(process.execPath);
    const launch = await resolveNodeLaunch(
      '/Users/me/sideboard/packages/core/dist/agents/cursor-runner.js',
    );
    expect(launch.file).toBeTruthy();
    expect(launch.env).toEqual({});
    expect(launch.file).not.toMatch(/Sideboard\.app/i);
  });

  it('prefers packaged extraResources Node over PATH', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-bundled-node-'));
    try {
      const bundled = join(root, 'node', 'bin', 'node');
      mkdirSync(join(bundled, '..'), { recursive: true });
      writeFileSync(bundled, '');
      proc.resourcesPath = root;
      mockNodeLookups('/opt/homebrew/bin/node');
      const launch = await resolveNodeLaunch(
        '/Users/me/sideboard/packages/core/dist/agents/cursor-runner.js',
      );
      expect(launch.file).toBe(bundled);
      expect(launch.env).toEqual({});
      expect(runMock).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses extraResources Node even when it lives under Sideboard.app', async () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'Sideboard.app-'));
    try {
      const resources = join(appRoot, 'Sideboard.app', 'Contents', 'Resources');
      const bundled = join(resources, 'node', 'bin', 'node');
      mkdirSync(join(bundled, '..'), { recursive: true });
      writeFileSync(bundled, '');
      proc.resourcesPath = resources;
      mockNodeLookups('/opt/homebrew/bin/node');
      const launch = await resolveNodeLaunch(
        join(resources, 'cursor-runtime', 'core-dist', 'agents', 'cursor-runner.js'),
      );
      expect(launch.file).toBe(bundled);
      expect(runMock).not.toHaveBeenCalled();
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('does not wrap system node', () => {
    const applied = applyNodeLaunch(
      { file: '/opt/homebrew/bin/node', env: {} },
      ['/tmp/run-stdio.js'],
    );
    expect(applied).toEqual({
      file: '/opt/homebrew/bin/node',
      args: ['/tmp/run-stdio.js'],
      env: { NODE_OPTIONS: '--max-old-space-size=8192' },
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
      expect(applied.env.NODE_OPTIONS).toBe('--max-old-space-size=8192');
      return;
    }
    expect(applied.file).toBe('/bin/sh');
    expect(applied.args).toContain('/Apps/Sideboard.app/MacOS/Sideboard');
    expect(applied.args.at(-1)).toBe('/tmp/run-stdio.js');
    expect(applied.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(applied.env.NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });
});
