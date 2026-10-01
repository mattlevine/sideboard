import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MAC_OPEN,
  cleanOpenEnv,
  expandHome,
  finderLaunchCommands,
  finderRevealArgs,
  finderRevealTarget,
  formatOpenWorktreeError,
  isMissingAppError,
  listOpenerBundles,
  openFolderWithApp,
  openWorktreeArgs,
  openerIdForEditor,
  openerSpec,
  pngDataUrlFromIcns,
  pngDataUrlFromIcnsFile,
  resolveBundleIconPath,
  resolveBundlePath,
} from './open-worktree';

describe('openWorktreeArgs', () => {
  it('reveals Finder via Launch Services, then activates Finder with no folder', () => {
    expect(finderRevealArgs('/tmp/wt')).toEqual({
      file: MAC_OPEN,
      args: ['-R', '/tmp/wt'],
    });
    expect(finderLaunchCommands('/tmp/wt/packages')).toEqual([
      { file: MAC_OPEN, args: ['-R', '/tmp/wt/packages'] },
      { file: MAC_OPEN, args: ['-a', 'Finder'] },
    ]);
    expect(finderRevealTarget('/tmp/wt', ['packages', '.git'])).toBe('/tmp/wt/packages');
    expect(finderRevealTarget('/tmp/wt', ['.git'])).toBe('/tmp/wt/.git');
    expect(finderRevealTarget('/tmp/wt', [])).toBe('/tmp/wt');
  });

  it('strips Electron env so /usr/bin/open is not a nested-Electron no-op', () => {
    expect(
      cleanOpenEnv({
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:1',
        CHROME_CRASHPAD_PIPE_NAME: 'x',
        HOME: '/Users/ada',
      }),
    ).toEqual({ PATH: '/usr/bin', HOME: '/Users/ada' });
  });

  it('opens VS Code and Cursor via Launch Services, not CLI shims', () => {
    expect(openWorktreeArgs('Visual Studio Code', '/tmp/wt').file).toBe(MAC_OPEN);
    expect(openWorktreeArgs('Visual Studio Code', '/tmp/wt').args).toEqual([
      '-a',
      'Visual Studio Code',
      '/tmp/wt',
    ]);
    expect(openWorktreeArgs('Cursor', '/tmp/wt').args[1]).toBe('Cursor');
    expect(openWorktreeArgs('Visual Studio Code', '/tmp/wt').file).not.toBe('code');
    expect(openWorktreeArgs('Cursor', '/tmp/wt').file).not.toBe('cursor');
  });
});

describe('resolveBundlePath', () => {
  it('expands ~ and returns the first existing bundle', () => {
    expect(expandHome('~/Applications/Cursor.app', '/Users/ada')).toBe(
      '/Users/ada/Applications/Cursor.app',
    );
    const spec = openerSpec('cursor');
    expect(
      resolveBundlePath(spec, {
        home: '/Users/ada',
        exists: (p) => p === '/Users/ada/Applications/Cursor.app',
      }),
    ).toBe('/Users/ada/Applications/Cursor.app');
  });

  it('lists Finder as installed even without a bundle probe', () => {
    const listed = listOpenerBundles({ home: '/Users/ada', exists: () => false });
    expect(listed.find((o) => o.id === 'finder')?.installed).toBe(true);
    expect(listed.find((o) => o.id === 'code')?.installed).toBe(false);
  });
});

describe('resolveBundleIconPath', () => {
  it('finds Cursor.icns under Contents/Resources', () => {
    expect(
      resolveBundleIconPath('/Applications/Cursor.app', {
        exists: (p) => p === '/Applications/Cursor.app/Contents/Resources/Cursor.icns',
        iconFiles: ['Cursor.icns'],
      }),
    ).toBe('/Applications/Cursor.app/Contents/Resources/Cursor.icns');
  });

  it('adds .icns when Info.plist omits the extension', () => {
    expect(
      resolveBundleIconPath('/System/Library/CoreServices/Finder.app', {
        exists: (p) => p.endsWith('/Finder.icns'),
        iconFiles: ['Finder'],
      }),
    ).toBe('/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns');
  });
});

describe('pngDataUrlFromIcns', () => {
  it('encodes sips PNG output as a data URL', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(20).fill(1)]);
    const url = pngDataUrlFromIcns('/tmp/App.icns', {
      execFileSync: () => {},
      readFileSync: () => png,
      mkdtempSync: () => '/tmp/sb-opener-icon-xyz',
      rmSync: () => {},
      tmpdir: () => '/tmp',
    });
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(url!.slice('data:image/png;base64,'.length), 'base64').equals(png)).toBe(
      true,
    );
  });

  it('converts a real Cursor.icns on this Mac', () => {
    const icns = '/Applications/Cursor.app/Contents/Resources/Cursor.icns';
    if (!existsSync(icns)) return;
    const url = pngDataUrlFromIcnsFile(icns);
    expect(url?.startsWith('data:image/png;base64,')).toBe(true);
    expect(url!.length).toBeGreaterThan(500);
  });
});

describe('openerIdForEditor', () => {
  it('maps CLI names onto apps so we never spawn `code` / `cursor`', () => {
    expect(openerIdForEditor('code')).toBe('code');
    expect(openerIdForEditor('VS Code')).toBe('code');
    expect(openerIdForEditor('cursor')).toBe('cursor');
    expect(openerIdForEditor('/usr/local/bin/cursor')).toBeNull();
  });
});

describe('formatOpenWorktreeError', () => {
  it('turns spawn ENOENT into a readable missing-app message', () => {
    const err = Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' });
    expect(isMissingAppError(err)).toBe(true);
    expect(formatOpenWorktreeError(err, openerSpec('code'))).toMatch(/VS Code isn’t installed/i);
  });
});

describe('openFolderWithApp', () => {
  it('tries VS Code then Insiders, and never calls the `code` binary', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execFile = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      if (args[1] === 'Visual Studio Code') {
        throw new Error("Unable to find application named 'Visual Studio Code'");
      }
    });
    await openFolderWithApp('code', '/tmp/wt', {
      execFile,
      exists: (p) => p === '/tmp/wt',
      home: '/Users/ada',
    });
    expect(calls.map((c) => c.file)).toEqual([MAC_OPEN, MAC_OPEN]);
    expect(calls[0]?.args).toEqual(['-a', 'Visual Studio Code', '/tmp/wt']);
    expect(calls[1]?.args).toEqual(['-a', 'Visual Studio Code - Insiders', '/tmp/wt']);
  });

  it('rejects with a friendly error when the folder is missing', async () => {
    await expect(
      openFolderWithApp('finder', '/missing', {
        execFile: vi.fn(),
        exists: () => false,
        home: '/Users/ada',
      }),
    ).rejects.toThrow(/Worktree folder is missing/);
  });

  it('rejects with a friendly error when no app name works', async () => {
    await expect(
      openFolderWithApp('code', '/tmp/wt', {
        execFile: async () => {
          throw Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' });
        },
        exists: (p) => p === '/tmp/wt',
        home: '/Users/ada',
      }),
    ).rejects.toThrow(/VS Code isn’t installed/);
  });

  it('opens Finder by revealing the folder (no AppleScript)', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    await openFolderWithApp('finder', '/tmp/wt', {
      execFile: async (file, args) => {
        calls.push({ file, args });
      },
      exists: (p) => p === '/tmp/wt',
      home: '/Users/ada',
    });
    expect(calls).toEqual([
      { file: MAC_OPEN, args: ['-R', '/tmp/wt'] },
      { file: MAC_OPEN, args: ['-a', 'Finder'] },
    ]);
  });
});
