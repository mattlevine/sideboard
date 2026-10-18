import { spawn, type ChildProcess } from 'node:child_process';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { caffeinateWhileRunningEnabled, caffeinateWhileSchedulesEnabled, caffeinateWhileSlackListenEnabled, loadAppSettings } from '../store/app-settings.js';
import {
  claimDesktopHost,
  isDesktopHostAlive,
  isThisProcessDesktopHost,
  releaseDesktopHost,
} from '../store/desktop-host.js';
import { ensureRemoteHostCredentials, saveRemotePhoneToken } from '../store/device-identity.js';
import { hasEnabledSchedules } from '../store/schedules.js';
import { armSchedules } from '../orchestrator/schedule-runner.js';
import { runRemoteHost } from '../remote/client.js';
import { remoteRelayUrl } from '../remote/protocol.js';
import { startRelayServer } from '../relay/server.js';

const REARM_MS = 15_000;

export function headlessHostBlockedReason(): string | null {
  if (isDesktopHostAlive() && !isThisProcessDesktopHost()) {
    return 'Sideboard.app is already hosting this Mac. Quit it before sideboard serve.';
  }
  return null;
}

/** Phone relay URLs for a LAN listener. Loopback first, then other IPv4 addresses. */
export function lanRelayUrls(port: number, families: NetworkInterfaceInfo[] = flatInterfaces()): string[] {
  const urls = [`ws://127.0.0.1:${port}/remote`];
  for (const row of families) {
    const v4 = row.family === 'IPv4' || (row.family as unknown) === 4;
    if (!v4 || row.internal) continue;
    if (!row.address || row.address.startsWith('169.254.')) continue;
    const url = `ws://${row.address}:${port}/remote`;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

export type HeadlessHostHandle = {
  ok: true;
  lanUrls: string[];
  stop: () => Promise<void>;
};

/** Own schedules and the phone relay while the desktop app is not running. */
export async function startHeadlessHost(opts?: {
  lan?: boolean;
  signal?: AbortSignal;
}): Promise<HeadlessHostHandle | { ok: false; reason: string }> {
  const blocked = headlessHostBlockedReason();
  if (blocked) return { ok: false, reason: blocked };
  claimDesktopHost();
  armSchedules();

  const ac = new AbortController();
  let stopped = false;
  let phoneConnected = false;
  let agentsRunning = 0;
  let caffeinate: ChildProcess | null = null;
  let relay: Awaited<ReturnType<typeof startRelayServer>> | null = null;
  try {
    relay = opts?.lan
      ? await startRelayServer({ skipSocketMode: true, host: '0.0.0.0', port: 0, signal: ac.signal })
      : null;
  } catch (err) {
    releaseDesktopHost();
    throw err;
  }
  const lanUrls = relay ? lanRelayUrls(relay.port) : [];
  const relayUrl = relay
    ? `ws://127.0.0.1:${relay.port}/remote`
    : remoteRelayUrl(loadAppSettings().integrations.remoteRelayUrl);
  const creds = ensureRemoteHostCredentials();
  const accountToken = relay ? undefined : loadAppSettings().integrations.remoteAccountToken;

  const stopCaffeinate = () => {
    if (!caffeinate) return;
    try {
      caffeinate.kill();
    } catch {
      // already gone
    }
    caffeinate = null;
  };

  const refreshRunning = async () => {
    try {
      const { getOrchestrator } = await import('../orchestrator/orchestrator.js');
      agentsRunning = getOrchestrator().getRuntime().running;
    } catch {
      agentsRunning = 0;
    }
  };

  const refreshAwake = () => {
    const keep =
      (caffeinateWhileSchedulesEnabled() && hasEnabledSchedules()) ||
      (caffeinateWhileSlackListenEnabled() && phoneConnected) ||
      (caffeinateWhileRunningEnabled() && agentsRunning > 0);
    if (keep && !caffeinate && process.platform === 'darwin') {
      try {
        caffeinate = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });
        caffeinate.on('exit', () => {
          caffeinate = null;
        });
      } catch {
        caffeinate = null;
      }
    } else if (!keep) {
      stopCaffeinate();
    }
  };

  runRemoteHost({
    url: relayUrl,
    deviceId: creds.deviceId,
    deviceLabel: creds.deviceLabel,
    hostSecret: creds.hostSecret,
    hostPrivateKey: creds.hostPrivateKey,
    phoneToken: creds.phoneToken,
    onPhoneToken: saveRemotePhoneToken,
    ...(accountToken ? { accountToken } : {}),
    signal: ac.signal,
    onStatus: (status) => {
      phoneConnected = status.phoneConnected;
      refreshAwake();
    },
  });
  refreshAwake();

  const timer = setInterval(() => {
    if (!isThisProcessDesktopHost()) {
      void stop();
      return;
    }
    armSchedules();
    void refreshRunning().then(() => refreshAwake());
  }, REARM_MS);
  timer.unref?.();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stopCaffeinate();
    ac.abort();
    if (relay) await relay.close();
    releaseDesktopHost();
  };

  const onAbort = () => {
    void stop();
  };
  opts?.signal?.addEventListener('abort', onAbort, { once: true });

  return { ok: true, lanUrls, stop };
}

function flatInterfaces(): NetworkInterfaceInfo[] {
  const out: NetworkInterfaceInfo[] = [];
  for (const rows of Object.values(networkInterfaces())) {
    if (!rows) continue;
    out.push(...rows);
  }
  return out;
}
