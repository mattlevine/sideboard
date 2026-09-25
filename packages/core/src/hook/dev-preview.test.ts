import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeRunPreview,
  classifyRunScriptPreview,
  commandLooksLikeElectron,
  parseDevPreview,
  pnpmFilterPackage,
} from './dev-preview.js';

describe('parseDevPreview', () => {
  it('accepts url and window', () => {
    expect(parseDevPreview('url')).toBe('url');
    expect(parseDevPreview('window')).toBe('window');
    expect(parseDevPreview('browser')).toBeUndefined();
  });
});

describe('commandLooksLikeElectron', () => {
  it('matches electron-vite and electron binaries', () => {
    expect(commandLooksLikeElectron('electron-vite dev')).toBe(true);
    expect(commandLooksLikeElectron('npx electron .')).toBe(true);
    expect(commandLooksLikeElectron('electron-forge start')).toBe(true);
  });

  it('does not match Electron env var names', () => {
    expect(
      commandLooksLikeElectron('env -u ELECTRON_RUN_AS_NODE pnpm --filter web dev'),
    ).toBe(false);
    expect(commandLooksLikeElectron('PORT=5173 pnpm --filter web dev')).toBe(
      false,
    );
  });
});

describe('pnpmFilterPackage', () => {
  it('reads --filter name', () => {
    expect(
      pnpmFilterPackage(
        'PORT=5173 pnpm --filter @sideboard-ai/desktop run dev',
      ),
    ).toBe('@sideboard-ai/desktop');
    expect(pnpmFilterPackage('pnpm --filter=web dev')).toBe('web');
  });
});

describe('classifyRunScriptPreview', () => {
  it('honors an explicit preview override', () => {
    expect(
      classifyRunScriptPreview({
        command: 'electron-vite dev',
        preview: 'url',
      }),
    ).toBe('url');
    expect(
      classifyRunScriptPreview({
        command: 'pnpm --filter web dev',
        preview: 'window',
      }),
    ).toBe('window');
  });

  it('classifies a filtered Electron package as window', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-preview-el-'));
    mkdirSync(join(root, 'apps', 'desktop'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'app', private: true }),
    );
    writeFileSync(
      join(root, 'apps', 'desktop', 'package.json'),
      JSON.stringify({
        name: '@acme/desktop',
        dependencies: { electron: '34.0.0' },
        scripts: { dev: 'electron-vite dev' },
      }),
    );
    expect(
      classifyRunScriptPreview({
        command: 'PORT=5173 pnpm --filter @acme/desktop run dev',
        worktreePath: root,
      }),
    ).toBe('window');
  });

  it('classifies a filtered web package as url even if a sibling is Electron', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-preview-web-'));
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    mkdirSync(join(root, 'apps', 'desktop'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({
        name: 'web',
        dependencies: { next: '15.0.0' },
        scripts: { dev: 'next dev' },
      }),
    );
    writeFileSync(
      join(root, 'apps', 'desktop', 'package.json'),
      JSON.stringify({
        name: 'desktop',
        dependencies: { electron: '34.0.0' },
      }),
    );
    expect(
      classifyRunScriptPreview({
        command: 'PORT=3000 pnpm --filter web dev',
        worktreePath: root,
      }),
    ).toBe('url');
  });

  it('classifies a root electron-vite app as window', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-preview-root-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'desktop',
        devDependencies: { 'electron-vite': '2.0.0' },
        scripts: { dev: 'electron-vite dev' },
      }),
    );
    expect(
      classifyRunScriptPreview({
        command: 'PORT=5173 pnpm dev',
        worktreePath: root,
      }),
    ).toBe('window');
  });
});

describe('activeRunPreview', () => {
  it('looks up the named script', () => {
    expect(
      activeRunPreview(
        'dev',
        [{ name: 'dev', command: 'electron-vite dev' }],
        null,
      ),
    ).toBe('window');
    expect(
      activeRunPreview(
        'web',
        [{ name: 'web', command: 'pnpm --filter web dev' }],
        null,
      ),
    ).toBe('url');
  });
});
