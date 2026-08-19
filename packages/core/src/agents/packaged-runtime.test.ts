import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  packagedCursorRipgrepCandidate,
  packagedCursorRunnerPath,
  packagedCursorRuntimeDir,
} from './packaged-runtime.js';

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

describe('packaged cursor runtime', () => {
  const proc = process as ProcessWithResources;
  const previous = proc.resourcesPath;
  let root: string | undefined;

  afterEach(() => {
    if (previous === undefined) delete proc.resourcesPath;
    else proc.resourcesPath = previous;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('returns null when extraResources is not staged', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-runtime-'));
    proc.resourcesPath = root;
    expect(packagedCursorRuntimeDir()).toBeNull();
    expect(packagedCursorRunnerPath()).toBeNull();
  });

  it('resolves the extraResources runner and ripgrep candidate', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-runtime-'));
    const runner = join(root, 'cursor-runtime', 'core-dist', 'agents', 'cursor-runner.js');
    mkdirSync(join(runner, '..'), { recursive: true });
    writeFileSync(runner, '');
    proc.resourcesPath = root;

    expect(packagedCursorRuntimeDir()).toBe(join(root, 'cursor-runtime'));
    expect(packagedCursorRunnerPath()).toBe(runner);
    expect(packagedCursorRipgrepCandidate('@cursor/sdk-darwin-arm64', 'rg')).toBe(
      join(root, 'cursor-runtime', 'node_modules', '@cursor/sdk-darwin-arm64', 'bin', 'rg'),
    );
  });
});
