import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cursorRipgrepEnv,
  resolveCursorRipgrepPath,
  usableRipgrepPath,
} from './cursor-ripgrep.js';

const pkg = `@cursor/sdk-${process.platform}-${process.arch}`;
const binName = process.platform === 'win32' ? 'rg.exe' : 'rg';

describe('usableRipgrepPath', () => {
  it('rejects relative and missing paths', () => {
    expect(usableRipgrepPath('rg')).toBeNull();
    expect(usableRipgrepPath('/no/such/rg')).toBeNull();
  });

  it('rejects asar paths that have no unpacked sibling', () => {
    expect(
      usableRipgrepPath(
        `/Apps/Sideboard.app/Contents/Resources/app.asar/node_modules/${pkg}/bin/${binName}`,
      ),
    ).toBeNull();
  });
});

describe('resolveCursorRipgrepPath', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('honors an absolute CURSOR_RIPGREP_PATH', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-rg-'));
    const rg = join(root, binName);
    writeFileSync(rg, '');
    expect(resolveCursorRipgrepPath({ env: { CURSOR_RIPGREP_PATH: rg } })).toBe(rg);
  });

  it('walks from the runner script to unpacked @cursor/sdk-<plat>/bin/rg', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-rg-asar-'));
    const asarRunner = join(
      root,
      'app.asar',
      'node_modules',
      '@sideboard-ai',
      'core',
      'dist',
      'agents',
      'cursor-runner.js',
    );
    const unpackedRg = join(
      root,
      'app.asar.unpacked',
      'node_modules',
      pkg,
      'bin',
      binName,
    );
    mkdirSync(join(asarRunner, '..'), { recursive: true });
    writeFileSync(asarRunner, '');
    mkdirSync(join(unpackedRg, '..'), { recursive: true });
    writeFileSync(unpackedRg, '');
    chmodSync(unpackedRg, 0o755);

    const resolved = resolveCursorRipgrepPath({
      env: {},
      startFile: asarRunner,
    });
    expect(resolved).toBe(unpackedRg);
    expect(cursorRipgrepEnv({ env: {}, startFile: asarRunner })).toEqual({
      CURSOR_RIPGREP_PATH: unpackedRg,
    });
  });

  it('walks from extraResources cursor-runtime to bundled rg', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-rg-extra-'));
    const runner = join(root, 'cursor-runtime', 'core-dist', 'agents', 'cursor-runner.js');
    const rg = join(root, 'cursor-runtime', 'node_modules', pkg, 'bin', binName);
    mkdirSync(join(runner, '..'), { recursive: true });
    writeFileSync(runner, '');
    mkdirSync(join(rg, '..'), { recursive: true });
    writeFileSync(rg, '');
    chmodSync(rg, 0o755);

    expect(resolveCursorRipgrepPath({ env: {}, startFile: runner })).toBe(rg);
  });
});
