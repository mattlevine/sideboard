import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURSOR_SDK_INSTALL_HINT,
  cursorSdkRipgrepCandidate,
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
