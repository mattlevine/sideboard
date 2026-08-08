import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWorktreeFile, readWorktreeFileForUpload } from './diff.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readWorktreeFile images', () => {
  it('returns base64 for image extensions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-img-'));
    dirs.push(dir);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    writeFileSync(join(dir, 'logo.png'), bytes);

    const r = readWorktreeFile(dir, 'logo.png');
    expect(r.encoding).toBe('base64');
    expect(r.binary).toBe(true);
    expect(r.content).toBe(bytes.toString('base64'));
  });

  it('still stubs non-image binaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-bin-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 4]));

    const r = readWorktreeFile(dir, 'blob.bin');
    expect(r.binary).toBe(true);
    expect(r.encoding).toBe('utf8');
    expect(r.content).toMatch(/binary file/);
  });
});

describe('readWorktreeFileForUpload', () => {
  it('returns base64 for non-image binaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-upload-'));
    dirs.push(dir);
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5]);
    writeFileSync(join(dir, 'blob.bin'), bytes);

    const r = readWorktreeFileForUpload(dir, 'blob.bin');
    expect(r.contentBase64).toBe(bytes.toString('base64'));
    expect(r.size).toBe(6);
  });
});
