import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimDesktopHost,
  isDesktopHostAlive,
  isThisProcessDesktopHost,
  readDesktopHostPid,
  releaseDesktopHost,
  thisProcessShouldDrainAgentQueues,
} from './desktop-host.js';

describe('desktop host pid', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-desktop-host-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('claims and releases this process as the desktop host', () => {
    expect(isDesktopHostAlive()).toBe(false);
    expect(thisProcessShouldDrainAgentQueues()).toBe(true);

    claimDesktopHost();
    expect(readDesktopHostPid()).toBe(process.pid);
    expect(isThisProcessDesktopHost()).toBe(true);
    expect(isDesktopHostAlive()).toBe(true);
    expect(thisProcessShouldDrainAgentQueues()).toBe(true);

    releaseDesktopHost();
    expect(readDesktopHostPid()).toBeNull();
    expect(thisProcessShouldDrainAgentQueues()).toBe(true);
  });

  it('does not drain in this process when another live pid owns the board', () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      expect(child.pid).toBeTruthy();
      writeFileSync(join(dataDir, 'desktop-host.pid'), `${child.pid}\n`);
      expect(isDesktopHostAlive()).toBe(true);
      expect(isThisProcessDesktopHost()).toBe(false);
      expect(thisProcessShouldDrainAgentQueues()).toBe(false);
    } finally {
      child.kill();
    }
  });

  it('does not release a pid claimed by someone else', () => {
    claimDesktopHost(process.pid);
    releaseDesktopHost(process.pid + 1);
    expect(readDesktopHostPid()).toBe(process.pid);
    releaseDesktopHost();
  });
});
