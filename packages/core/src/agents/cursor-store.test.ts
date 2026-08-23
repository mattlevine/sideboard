import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CURSOR_SDK_STORE_DIR,
  cursorSdkRunsNdjsonSearchPaths,
  cursorSdkStoreDir,
} from './cursor-store.js';

describe('cursorSdkStoreDir', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-cursor-store-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps the shared catalog when no thread id is given', () => {
    expect(cursorSdkStoreDir()).toBe(join(dataDir, CURSOR_SDK_STORE_DIR));
    expect(cursorSdkStoreDir('')).toBe(join(dataDir, CURSOR_SDK_STORE_DIR));
  });

  it('isolates each thread under threads/<id>', () => {
    expect(cursorSdkStoreDir('00e995d0-9c13-4263-9334-b6082b91b19a')).toBe(
      join(dataDir, CURSOR_SDK_STORE_DIR, 'threads', '00e995d0-9c13-4263-9334-b6082b91b19a'),
    );
  });

  it('strips path segments from a hostile thread id', () => {
    expect(cursorSdkStoreDir('../etc/passwd')).toBe(
      join(dataDir, CURSOR_SDK_STORE_DIR, 'threads', '.._etc_passwd'),
    );
  });

  it('searches the thread catalog before the legacy shared file', () => {
    expect(cursorSdkRunsNdjsonSearchPaths('t1')).toEqual([
      join(dataDir, CURSOR_SDK_STORE_DIR, 'threads', 't1', 'runs.ndjson'),
      join(dataDir, CURSOR_SDK_STORE_DIR, 'runs.ndjson'),
    ]);
  });
});
