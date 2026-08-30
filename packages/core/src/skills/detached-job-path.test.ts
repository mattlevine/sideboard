import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDetachedJobInvoke,
  packagedDetachedJobPath,
  resolveDetachedJobScript,
} from './detached-job-path.js';

const repoScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/detached-job.js',
);

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

describe('resolveDetachedJobScript', () => {
  const proc = process as ProcessWithResources;
  const previous = proc.resourcesPath;
  let root: string | undefined;

  afterEach(() => {
    if (previous === undefined) delete proc.resourcesPath;
    else proc.resourcesPath = previous;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('finds the repo scripts/detached-job.js when unpackaged', () => {
    delete proc.resourcesPath;
    expect(resolveDetachedJobScript()).toBe(repoScript);
    expect(formatDetachedJobInvoke()).toBe(`node ${JSON.stringify(repoScript)}`);
  });

  it('prefers the packaged extraResources copy', () => {
    root = mkdtempSync(join(tmpdir(), 'sb-detached-'));
    const mcp = join(root, 'sideboard-mcp', 'core-dist', 'mcp', 'run-stdio.js');
    mkdirSync(join(mcp, '..'), { recursive: true });
    writeFileSync(mcp, '');
    const script = join(root, 'sideboard-mcp', 'scripts', 'detached-job.js');
    mkdirSync(join(script, '..'), { recursive: true });
    writeFileSync(script, '#!/usr/bin/env node\n');
    proc.resourcesPath = root;

    expect(packagedDetachedJobPath()).toBe(script);
    expect(resolveDetachedJobScript()).toBe(script);
  });

  it('quotes a provided path for the shell', () => {
    expect(formatDetachedJobInvoke('/tmp/detached-job.js')).toBe(
      'node "/tmp/detached-job.js"',
    );
    expect(formatDetachedJobInvoke(null)).toBe('node scripts/detached-job.js');
  });
});
