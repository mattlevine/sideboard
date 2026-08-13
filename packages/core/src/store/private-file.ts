import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Owner-read/write only. Applied on create and again after overwrite (mode is create-only). */
export const PRIVATE_FILE_MODE = 0o600;

export function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  chmodOwnerOnly(path);
}

export function chmodOwnerOnly(path: string): void {
  try {
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch {
    // Best-effort on filesystems that ignore POSIX modes.
  }
}
