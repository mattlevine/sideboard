/**
 * Trust OS / Keychain CAs in Node (undici `fetch`).
 *
 * Electron main Linear (create-worktree issue picker) uses `net.fetch` —
 * Chromium already reads the system store. Agent Linear tools run in a
 * real Node MCP process whose Mozilla bundle does not include corporate
 * VPN/proxy CAs, which surfaces as UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
 *
 * Node 22.15+ can load the system store (`NODE_USE_SYSTEM_CA=1` /
 * `tls.getCACertificates('system')`). Older Node and some Keychain layouts
 * still need a PEM dump via `NODE_EXTRA_CA_CERTS`.
 */
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { appDataDir } from '../store/paths.js';

export const NODE_USE_SYSTEM_CA = 'NODE_USE_SYSTEM_CA';
export const NODE_EXTRA_CA_CERTS = 'NODE_EXTRA_CA_CERTS';

const BUNDLE_NAME = 'system-ca.pem';
const BUNDLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LINUX_CA_FILES = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/etc/ssl/cert.pem',
];

const PEM_CERT_RE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

type TlsSystemCa = {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[];
  setDefaultCACertificates?: (certs: readonly (string | Buffer)[]) => void;
};

export type SystemCaSpawn = (
  file: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => { status: number | null; stdout?: string };

export type SystemCaIo = {
  platform?: NodeJS.Platform;
  spawn?: SystemCaSpawn;
  now?: () => number;
  appData?: () => string;
};

export function splitPemCertificates(pem: string): string[] {
  return pem.match(PEM_CERT_RE) ?? [];
}

function readExistingFile(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

function darwinKeychainPem(spawn: SystemCaSpawn): string {
  const result = spawn('/usr/bin/security', ['find-certificate', '-a', '-p'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 15_000,
  });
  if (result.status !== 0) return '';
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function linuxSystemCaPem(): string {
  for (const path of LINUX_CA_FILES) {
    const pem = readExistingFile(path);
    if (splitPemCertificates(pem).length > 0) return pem;
  }
  return '';
}

/** PEM of extra OS-trusted CAs (empty when none could be collected). */
export function collectSystemCaPem(io: SystemCaIo = {}): string {
  const platform = io.platform ?? process.platform;
  if (platform === 'darwin') {
    return darwinKeychainPem(io.spawn ?? spawnSync);
  }
  if (platform === 'linux') {
    return linuxSystemCaPem();
  }
  return '';
}

export function systemCaBundlePath(io: SystemCaIo = {}): string {
  return join((io.appData ?? appDataDir)(), BUNDLE_NAME);
}

function bundleIsFresh(path: string, now: number): boolean {
  try {
    if (!existsSync(path)) return false;
    if (splitPemCertificates(readFileSync(path, 'utf8')).length === 0) return false;
    return now - statSync(path).mtimeMs < BUNDLE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Write (or reuse) a PEM bundle under app data. Returns the path when the
 * file has at least one certificate. Never throws.
 */
export function materializeSystemCaBundle(io: SystemCaIo = {}): string | undefined {
  const inherited = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (inherited && splitPemCertificates(readExistingFile(inherited)).length > 0) {
    return inherited;
  }

  const platform = io.platform ?? process.platform;
  if (platform === 'linux') {
    for (const path of LINUX_CA_FILES) {
      if (splitPemCertificates(readExistingFile(path)).length > 0) return path;
    }
  }

  const dest = systemCaBundlePath(io);
  const now = (io.now ?? Date.now)();
  if (bundleIsFresh(dest, now)) return dest;

  const pem = collectSystemCaPem(io);
  if (splitPemCertificates(pem).length === 0) {
    return existsSync(dest) && splitPemCertificates(readExistingFile(dest)).length > 0
      ? dest
      : undefined;
  }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, pem.endsWith('\n') ? pem : `${pem}\n`, { mode: 0o600 });
    return dest;
  } catch {
    return undefined;
  }
}

/** Env for agent / MCP Node children so undici trusts Keychain / OS CAs. */
export function applySystemCaEnv(env: EnvLike): void {
  if (!String(env[NODE_USE_SYSTEM_CA] ?? '').trim()) {
    env[NODE_USE_SYSTEM_CA] = '1';
  }
  if (String(env[NODE_EXTRA_CA_CERTS] ?? '').trim()) return;
  const inherited = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (inherited) env[NODE_EXTRA_CA_CERTS] = inherited;
}

function extraCertsFromBundle(): string[] {
  const path = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (path) return splitPemCertificates(readExistingFile(path));
  const dest = systemCaBundlePath();
  return splitPemCertificates(readExistingFile(dest));
}

/**
 * Expand this process's default TLS CAs with the OS store. Safe no-op on
 * Node builds that lack `tls.getCACertificates` / `setDefaultCACertificates`.
 */
export function trustSystemCertificates(io: SystemCaIo = {}): boolean {
  try {
    const api = tls as unknown as TlsSystemCa;
    if (
      typeof api.getCACertificates !== 'function' ||
      typeof api.setDefaultCACertificates !== 'function'
    ) {
      return false;
    }
    const current = api.getCACertificates('default');
    const system = api.getCACertificates('system');
    let extra = extraCertsFromBundle();
    if (system.length === 0 && extra.length === 0) {
      extra = splitPemCertificates(collectSystemCaPem(io));
    }
    if (system.length === 0 && extra.length === 0) return false;
    api.setDefaultCACertificates([...current, ...system, ...extra]);
    return true;
  } catch {
    return false;
  }
}
