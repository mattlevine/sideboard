import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { fastForwardMainCheckoutIfSafe } from './worktree.js';

async function git(cwd: string, args: string[]) {
  await execa('git', args, { cwd });
}

async function revParse(cwd: string, ref: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', ref], { cwd });
  return stdout.trim();
}

describe('fastForwardMainCheckoutIfSafe', () => {
  let root = '';
  let remote = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (remote) rmSync(remote, { recursive: true, force: true });
    root = '';
    remote = '';
  });

  async function setupBehindOrigin() {
    remote = mkdtempSync(join(tmpdir(), 'sb-ff-remote-'));
    root = mkdtempSync(join(tmpdir(), 'sb-ff-main-'));
    await git(remote, ['init', '-b', 'main']);
    await git(remote, ['config', 'user.email', 'test@example.com']);
    await git(remote, ['config', 'user.name', 'Test']);
    writeFileSync(join(remote, 'a.txt'), '1\n');
    await git(remote, ['add', '.']);
    await git(remote, ['commit', '-m', 'init']);

    await git(root, ['clone', remote, '.']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test']);

    writeFileSync(join(remote, 'a.txt'), '2\n');
    await git(remote, ['add', '.']);
    await git(remote, ['commit', '-m', 'ahead']);
    await git(root, ['fetch', 'origin']);
  }

  it('fast-forwards a clean main checkout to origin/main', async () => {
    await setupBehindOrigin();
    const before = await revParse(root, 'HEAD');
    const origin = await revParse(root, 'origin/main');
    expect(before).not.toBe(origin);

    const result = await fastForwardMainCheckoutIfSafe(root);
    expect(result).toEqual({ updated: true, reason: 'updated' });
    expect(await revParse(root, 'HEAD')).toBe(origin);
  });

  it('skips when the project folder is dirty', async () => {
    await setupBehindOrigin();
    const before = await revParse(root, 'HEAD');
    writeFileSync(join(root, 'a.txt'), 'local\n');

    const result = await fastForwardMainCheckoutIfSafe(root);
    expect(result).toEqual({ updated: false, reason: 'dirty' });
    expect(await revParse(root, 'HEAD')).toBe(before);
  });

  it('skips when HEAD is not the default branch', async () => {
    await setupBehindOrigin();
    await git(root, ['checkout', '-b', 'feat']);
    const before = await revParse(root, 'HEAD');

    const result = await fastForwardMainCheckoutIfSafe(root);
    expect(result).toEqual({ updated: false, reason: 'not-on-default' });
    expect(await revParse(root, 'HEAD')).toBe(before);
  });

  it('skips when local main has diverged from origin', async () => {
    await setupBehindOrigin();
    writeFileSync(join(root, 'a.txt'), 'local-commit\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'diverge']);
    const before = await revParse(root, 'HEAD');

    const result = await fastForwardMainCheckoutIfSafe(root);
    expect(result).toEqual({ updated: false, reason: 'diverged' });
    expect(await revParse(root, 'HEAD')).toBe(before);
  });
});
