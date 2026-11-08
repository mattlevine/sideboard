import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** 32-byte AES key from base64 or 64 hex characters. */
export function parseSlackTokenKey(raw: string): Buffer {
  const text = raw.trim();
  if (!text) throw new Error('SIDEBOARD_SLACK_TOKEN_KEY is empty');
  const buf = /^[0-9a-fA-F]{64}$/.test(text)
    ? Buffer.from(text, 'hex')
    : Buffer.from(text, 'base64');
  if (buf.length !== 32) {
    throw new Error('SIDEBOARD_SLACK_TOKEN_KEY must be 32 bytes (base64 or 64 hex characters)');
  }
  return buf;
}

/** AES-256-GCM. The relay key lives in Fly secrets, not on the volume. */
export function sealSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    '.',
  );
}

export function openSecret(key: Buffer, sealed: string): string {
  const [version, ivB64, tagB64, ctB64] = sealed.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64 || sealed.split('.').length !== 4) {
    throw new Error('Slack secret ciphertext is not recognized');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
