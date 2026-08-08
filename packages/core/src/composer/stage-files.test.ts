import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachmentFromAbsolutePath,
  attachmentsFromWorktreePaths,
  isImageFilePath,
  stageAbsolutePathsAsAttachments,
  stageBuffersAsAttachments,
} from './stage-files.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sideboard-stage-'));
  dirs.push(d);
  return d;
}

describe('stage-files', () => {
  it('detects image paths', () => {
    expect(isImageFilePath('shot.PNG')).toBe(true);
    expect(isImageFilePath('notes.md')).toBe(false);
  });

  it('builds image attachment with preview from absolute path', () => {
    const dir = tempDir();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const abs = join(dir, 'shot.png');
    writeFileSync(abs, png);
    const att = attachmentFromAbsolutePath(abs);
    expect(att.name).toBe('shot.png');
    expect(att.previewDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    expect(att.content).toMatch(/Image attached/);
  });

  it('stages external files into .sideboard/attachments', () => {
    const worktree = tempDir();
    const srcDir = tempDir();
    const abs = join(srcDir, 'hello.txt');
    writeFileSync(abs, 'hello world');
    const [att] = stageAbsolutePathsAsAttachments(worktree, [abs]);
    expect(att?.path).toBe('.sideboard/attachments/hello.txt');
    expect(att?.content).toBe('hello world');
  });

  it('attaches existing worktree-relative images with path', () => {
    const worktree = tempDir();
    mkdirSync(join(worktree, 'assets'), { recursive: true });
    const rel = 'assets/logo.png';
    writeFileSync(
      join(worktree, rel),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const [att] = attachmentsFromWorktreePaths(worktree, [rel]);
    expect(att?.path).toBe(rel);
    expect(att?.previewDataUrl).toBeTruthy();
  });

  it('stages in-memory buffers into attachments', () => {
    const worktree = tempDir();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const [att] = stageBuffersAsAttachments(worktree, [
      { name: 'drop.png', dataBase64: png.toString('base64') },
    ]);
    expect(att?.path).toBe('.sideboard/attachments/drop.png');
    expect(att?.previewDataUrl).toBeTruthy();
  });
});
