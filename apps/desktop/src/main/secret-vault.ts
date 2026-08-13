import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import * as core from '@sideboard-ai/core';

function writeSafeStorageKey(path: string, key: Buffer): void {
  writeFileSync(path, safeStorage.encryptString(key.toString('hex')));
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }
}

function readSafeStorageKey(path: string): Buffer | null {
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path)).trim();
    if (/^[0-9a-f]{64}$/i.test(decrypted)) return Buffer.from(decrypted, 'hex');
  } catch {
    return null;
  }
  return null;
}

/**
 * Unlock AES secret files with a key kept in Electron safeStorage and the login
 * Keychain so the CLI can decrypt the same files.
 * Never throws — a vault failure must not block app launch.
 */
export function initDesktopSecretVault(): void {
  try {
    const setKey = core.setVaultMasterKey;
    const persist = core.persistVaultKeyInKeychain;
    const readChain = core.readKeychainVaultKey;
    const unlocks = core.secureFileUnlocksWith;
    if (typeof setKey !== 'function') return;

    const keyPath = join(core.appDataDir(), 'vault.key');
    const secretsPath = join(core.appDataDir(), 'secrets.json');
    const workspacesPath = join(core.appDataDir(), 'slack-workspaces.json');
    const fromFile = readSafeStorageKey(keyPath);
    const fromChain = typeof readChain === 'function' ? readChain() : null;
    const candidates = [fromFile, fromChain].filter((k): k is Buffer => Boolean(k));

    let key =
      typeof unlocks === 'function'
        ? (candidates.find((k) => unlocks(secretsPath, k) && unlocks(workspacesPath, k)) ??
          null)
        : null;
    if (!key) key = fromFile ?? fromChain ?? randomBytes(32);

    setKey(key);
    if (safeStorage.isEncryptionAvailable()) writeSafeStorageKey(keyPath, key);
    if (typeof persist === 'function') persist(key);
  } catch (err) {
    console.warn(
      'Secret vault init skipped:',
      err instanceof Error ? err.message : err,
    );
  }
}
