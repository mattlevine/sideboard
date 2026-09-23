import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURSOR_SDK_INSTALL_HINT,
  cursorSdkEsmEntry,
  cursorSdkHasExpectedExports,
  cursorSdkRipgrepCandidate,
  importCursorSdk,
  isCursorSdkInstalled,
  resolveCursorSdkRoot,
} from './cursor-sdk-resolve.js';

const pkg = `@cursor/sdk-${process.platform}-${process.arch}`;
const binName = process.platform === 'win32' ? 'rg.exe' : 'rg';

describe('resolveCursorSdkRoot', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('honors SIDEBOARD_CURSOR_SDK when the tree is @cursor/sdk', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-cursor-sdk-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@cursor/sdk' }));
    expect(resolveCursorSdkRoot({ env: { SIDEBOARD_CURSOR_SDK: root } })).toBe(root);
    expect(isCursorSdkInstalled({ env: { SIDEBOARD_CURSOR_SDK: root } })).toBe(true);
  });

  it('fails closed when SIDEBOARD_CURSOR_SDK is set but is not the SDK', () => {
    expect(
      resolveCursorSdkRoot({ env: { SIDEBOARD_CURSOR_SDK: '/no/such/cursor-sdk' } }),
    ).toBeNull();
    expect(
      isCursorSdkInstalled({ env: { SIDEBOARD_CURSOR_SDK: '/no/such/cursor-sdk' } }),
    ).toBe(false);
  });

  it('finds rg next to a user-installed SDK', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-cursor-nm-'));
    const sdk = join(root, '@cursor/sdk');
    const rg = join(root, pkg, 'bin', binName);
    mkdirSync(sdk, { recursive: true });
    writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@cursor/sdk' }));
    mkdirSync(join(rg, '..'), { recursive: true });
    writeFileSync(rg, '');
    expect(
      cursorSdkRipgrepCandidate({ env: { SIDEBOARD_CURSOR_SDK: sdk } }),
    ).toBe(rg);
  });

  it('install hint mentions Settings Install', () => {
    expect(CURSOR_SDK_INSTALL_HINT).toMatch(/Install/);
    expect(CURSOR_SDK_INSTALL_HINT).toMatch(/@cursor\/sdk/);
  });
});

describe('importCursorSdk', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function fakeSdk(pkg: object, files: Record<string, string>): string {
    root = mkdtempSync(join(tmpdir(), 'sideboard-cursor-import-'));
    const sdk = join(root, 'node_modules', '@cursor', 'sdk');
    mkdirSync(sdk, { recursive: true });
    writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@cursor/sdk', ...pkg }));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(sdk, rel, '..'), { recursive: true });
      writeFileSync(join(sdk, rel), body);
    }
    return sdk;
  }

  it('prefers the ESM entry from exports["."].import over the require entry', async () => {
    const sdk = fakeSdk(
      {
        main: './dist/cjs/index.js',
        exports: {
          '.': {
            require: './dist/cjs/index.js',
            import: './dist/esm/index.js',
            default: './dist/esm/index.js',
          },
        },
      },
      {
        'dist/cjs/index.js': 'module.exports = { cjs: true };',
        'dist/esm/index.js':
          'export class Agent {}\nexport class JsonlLocalAgentStore {}\nexport const esm = true;',
        'dist/esm/package.json': '{"type":"module"}',
      },
    );
    expect(cursorSdkEsmEntry(sdk)).toBe(join(sdk, 'dist/esm/index.js'));
    const mod = await importCursorSdk({ env: { SIDEBOARD_CURSOR_SDK: sdk } });
    expect((mod as unknown as { esm?: boolean }).esm).toBe(true);
    expect(typeof mod?.JsonlLocalAgentStore).toBe('function');
    expect(cursorSdkHasExpectedExports(mod)).toBe(true);
  });

  it('unwraps default when only a CJS bundle is available', async () => {
    const sdk = fakeSdk(
      { main: './index.cjs' },
      {
        // Webpack-style CJS: named exports are not statically detectable.
        'index.cjs':
          'const e = {}; e.Agent = class Agent {}; e.JsonlLocalAgentStore = class S {}; module.exports = e;',
      },
    );
    expect(cursorSdkEsmEntry(sdk)).toBeNull();
    const mod = await importCursorSdk({ env: { SIDEBOARD_CURSOR_SDK: sdk } });
    expect(typeof mod?.Agent).toBe('function');
    expect(typeof mod?.JsonlLocalAgentStore).toBe('function');
  });

  it('flags a module without the expected exports', () => {
    expect(cursorSdkHasExpectedExports({ default: {} })).toBe(false);
    expect(cursorSdkHasExpectedExports(null)).toBe(false);
  });
});
