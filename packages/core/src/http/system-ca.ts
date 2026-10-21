/**
 * Trust OS / Keychain CAs in Node (undici `fetch`, `ws`, `https`).
 *
 * Electron main Linear (create-worktree issue picker) uses `net.fetch` —
 * Chromium already reads the system store. The phone relay WebSocket and
 * agent Linear tools use Node TLS, whose Mozilla bundle does not include
 * corporate VPN/proxy CAs (Zscaler), which surfaces as
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
 *
 * Node 22.15+ can load the system store (`NODE_USE_SYSTEM_CA=1` /
 * `tls.getCACertificates('system')`). Electron 34 ships Node 20, where
 * `NODE_EXTRA_CA_CERTS` is only read at process start and
 * `setDefaultCACertificates` does not exist — so we dump Keychain PEMs
 * and either pass them as `ca` or wrap `tls.createSecureContext`.
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
  createSecureContext?: typeof tls.createSecureContext;
  rootCertificates?: readonly string[];
  __sideboardSystemCaPatched?: boolean;
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
  tls?: TlsSystemCa;
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

function extraCertsFromBundle(io: SystemCaIo = {}): string[] {
  const path = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (path) return splitPemCertificates(readExistingFile(path));
  return splitPemCertificates(readExistingFile(systemCaBundlePath(io)));
}

function extraSystemCaPems(io: SystemCaIo = {}): string[] {
  const fromBundle = extraCertsFromBundle(io);
  if (fromBundle.length > 0) return fromBundle;
  return splitPemCertificates(collectSystemCaPem(io));
}

export function mergeSystemCaIntoTlsOptions(
  options: tls.SecureContextOptions | undefined,
  extra: readonly (string | Buffer)[],
  roots: readonly string[] = tls.rootCertificates,
): tls.SecureContextOptions {
  const existing = options?.ca;
  const base: Array<string | Buffer> =
    existing == null ? [...roots] : Array.isArray(existing) ? [...existing] : [existing];
  return { ...options, ca: [...base, ...extra] };
}

/** `ca` for Node `https` / `ws` when the process cannot change default CAs. */
export function systemCaTlsOptions(io: SystemCaIo = {}): { ca?: string[] } {
  const extra = extraSystemCaPems(io);
  if (extra.length === 0) return {};
  return { ca: [...tls.rootCertificates, ...extra] };
}

function installCreateSecureContextCaPatch(api: TlsSystemCa, extra: string[]): boolean {
  if (api.__sideboardSystemCaPatched) return true;
  if (typeof api.createSecureContext !== 'function') return false;
  const orig = api.createSecureContext;
  const roots = api.rootCertificates ?? tls.rootCertificates;
  api.createSecureContext = ((options?: tls.SecureContextOptions) =>
    orig(mergeSystemCaIntoTlsOptions(options, extra, roots))) as typeof tls.createSecureContext;
  api.__sideboardSystemCaPatched = true;
  return true;
}

/**
 * Expand this process's default TLS CAs with the OS store. Safe no-op on
 * Node builds that lack `tls.getCACertificates` / `setDefaultCACertificates`
 * *and* have no extra PEMs to wrap into `createSecureContext`.
 */
export function trustSystemCertificates(io: SystemCaIo = {}): boolean {
  try {
    const extra = extraSystemCaPems(io);
    const api = io.tls ?? (tls as TlsSystemCa);
    if (
      typeof api.getCACertificates === 'function' &&
      typeof api.setDefaultCACertificates === 'function'
    ) {
      const current = api.getCACertificates('default');
      const system = api.getCACertificates('system');
      if (system.length === 0 && extra.length === 0) return false;
      api.setDefaultCACertificates([...current, ...system, ...extra]);
      return true;
    }
    if (extra.length === 0) return false;
    return installCreateSecureContextCaPatch(api, extra);
  } catch {
    return false;
  }
}

/**
 * Dump OS CAs, export them for Node children, and trust them in this
 * process. Safe to call more than once. Never throws.
 */
export function bootstrapSystemCa(io: SystemCaIo = {}): void {
  const systemCaBundle = materializeSystemCaBundle(io);
  if (systemCaBundle && !process.env.NODE_EXTRA_CA_CERTS?.trim()) {
    process.env.NODE_EXTRA_CA_CERTS = systemCaBundle;
  }
  applySystemCaEnv(process.env);
  trustSystemCertificates(io);
}
