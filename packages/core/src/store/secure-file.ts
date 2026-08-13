import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmodOwnerOnly, writePrivateFile } from './private-file.js';

const KEYCHAIN_SERVICE = 'ai.sideboard.app';
const KEYCHAIN_ACCOUNT = 'secret-vault-v1';
const ALG = 'aes-256-gcm';

type EncryptedEnvelope = {
  v: 1;
  alg: typeof ALG;
  iv: string;
  tag: string;
  data: string;
};

let injectedKey: Buffer | null = null;

/** Desktop registers a 32-byte key from Electron safeStorage. */
export function setVaultMasterKey(key: Buffer | null): void {
  injectedKey = key && key.length === 32 ? Buffer.from(key) : null;
}

export function persistVaultKeyInKeychain(key: Buffer): void {
  if (process.platform !== 'darwin' || key.length !== 32) return;
  try {
    execFileSync(
      'security',
      [
        'add-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        KEYCHAIN_ACCOUNT,
        '-w',
        key.toString('hex'),
        '-U',
      ],
      { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    // CLI can still use SIDEBOARD_VAULT_KEY; desktop keeps the key via safeStorage.
  }
}

/** Existing Keychain vault key, if any. Does not create a new item. */
export function readKeychainVaultKey(): Buffer | null {
  return keychainKey(false);
}

function hexKey(value: string | undefined): Buffer | null {
  const trimmed = value?.trim() ?? '';
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

function keychainKey(create: boolean): Buffer | null {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    const key = hexKey(out);
    if (key) return key;
  } catch {
    // Missing item or user denied access.
  }
  if (!create) return null;
  const key = randomBytes(32);
  persistVaultKeyInKeychain(key);
  return key;
}

/**
 * AES-256-GCM key for secret files.
 * `SIDEBOARD_SECRET_VAULT=plain` (tests) skips encryption.
 */
export function resolveVaultKey(): Buffer | null {
  if (process.env.SIDEBOARD_SECRET_VAULT === 'plain') return null;
  if (injectedKey) return injectedKey;
  const fromEnv = hexKey(process.env.SIDEBOARD_VAULT_KEY);
  if (fromEnv) return fromEnv;
  // Never talk to the login keychain from unit tests.
  if (process.env.VITEST) return null;
  return keychainKey(true);
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.alg === ALG &&
    typeof o.iv === 'string' &&
    typeof o.tag === 'string' &&
    typeof o.data === 'string'
  );
}

function encryptJson(value: unknown, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptEnvelope(envelope: EncryptedEnvelope, key: Buffer): unknown {
  const decipher = createDecipheriv(ALG, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as unknown;
}

export function readSecureJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  chmodOwnerOnly(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isEnvelope(parsed)) return parsed as T;
  const key = resolveVaultKey();
  if (!key) {
    throw new Error(
      'Encrypted Sideboard secrets need a vault key (desktop Keychain / safeStorage, or SIDEBOARD_VAULT_KEY).',
    );
  }
  return decryptEnvelope(parsed, key) as T;
}

export function writeSecureJson(path: string, value: unknown): void {
  const key = resolveVaultKey();
  const body = key ? encryptJson(value, key) : value;
  writePrivateFile(path, `${JSON.stringify(body, null, 2)}\n`);
}

export function isSecureFileEncrypted(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return isEnvelope(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return false;
  }
}

/** True if `path` is missing, plaintext, or decrypts with `key`. */
export function secureFileUnlocksWith(path: string, key: Buffer): boolean {
  if (!existsSync(path) || key.length !== 32) return true;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isEnvelope(parsed)) return true;
    decryptEnvelope(parsed, key);
    return true;
  } catch {
    return false;
  }
}
