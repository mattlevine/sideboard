import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { phoneDirectoryListing, phoneFilePreview, phoneImageDataUrl, phoneWorktreeRelative } from './phone-media.js';

describe('phoneWorktreeRelative', () => {
  const root = '/tmp/sideboard-wt';

  it('keeps a repo-relative path and strips a line hash', () => {
    expect(phoneWorktreeRelative(root, 'apps/mobile/App.tsx#L12')).toBe('apps/mobile/App.tsx');
    expect(phoneWorktreeRelative(root, './shot.png')).toBe('shot.png');
  });

  it('accepts an absolute path inside the worktree and rejects the rest', () => {
    expect(phoneWorktreeRelative(root, '/tmp/sideboard-wt/shot.png')).toBe('shot.png');
    expect(phoneWorktreeRelative(root, 'file:///tmp/sideboard-wt/a%20b.png')).toBe('a b.png');
    expect(phoneWorktreeRelative(root, '/etc/passwd')).toBeNull();
    expect(phoneWorktreeRelative(root, '../secret.png')).toBeNull();
  });
});

describe('phoneImageDataUrl', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('inlines a small png and skips a file outside the worktree', () => {
    dir = mkdtempSync(join(tmpdir(), 'phone-image-'));
    mkdirSync(join(dir, 'shots'));
    writeFileSync(join(dir, 'shots', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const url = phoneImageDataUrl(dir, 'shots/a.png');
    expect(url?.startsWith('data:image/png;base64,')).toBe(true);
    expect(phoneImageDataUrl(dir, '/etc/passwd.png')).toBeNull();
    expect(phoneImageDataUrl(dir, 'notes.txt')).toBeNull();
  });
});

describe('phoneFilePreview', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('lists a folder and reads text and svg without leaving the worktree', () => {
    dir = mkdtempSync(join(tmpdir(), 'phone-file-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const n = 1;\n');
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const m = 2;\n');
    writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(phoneDirectoryListing(dir, 'src')?.content).toBe('a.ts\nb.ts');
    expect(phoneFilePreview(dir, 'src', 'dir')?.directory).toBe(true);
    expect(phoneFilePreview(dir, 'src/a.ts', 'file')?.content).toContain('export const n = 1');
    const svg = phoneFilePreview(dir, 'icon.svg', 'file');
    expect(svg?.encoding).toBe('utf8');
    expect(svg?.mime).toBe('image/svg+xml');
    expect(svg?.content.startsWith('<svg')).toBe(true);
  });
});
