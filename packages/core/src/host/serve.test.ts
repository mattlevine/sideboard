import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { desktopHostPidPath } from '../store/desktop-host.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import { headlessHostBlockedReason, lanRelayUrls, startHeadlessHost } from './serve.js';

describe('headless host', () => {
  let dataDir: string | undefined;
  const previousAppData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
    if (previousAppData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = previousAppData;
  });

  it('lists loopback and a LAN address for the phone relay', () => {
    expect(
      lanRelayUrls(8787, [
        { address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null },
        { address: '10.0.0.8', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null },
        { address: '169.254.1.1', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null },
      ]),
    ).toEqual(['ws://127.0.0.1:8787/remote', 'ws://10.0.0.8:8787/remote']);
  });

  it('refuses to start while the desktop process is the host', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-serve-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    writeFileSync(desktopHostPidPath(), `${process.ppid}\n`);
    expect(headlessHostBlockedReason()).toMatch(/already hosting/);
  });

  it('releases the host when stop was already requested', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-serve-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    const ac = new AbortController();
    ac.abort();
    const host = await startHeadlessHost({ signal: ac.signal });
    expect(host.ok).toBe(true);
    expect(isThisProcessDesktopHost()).toBe(false);
  });
});
