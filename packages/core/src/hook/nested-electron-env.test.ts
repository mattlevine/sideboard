import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  dropNestedElectronEnvFromProcess,
  isNestedElectronEnvKey,
  STRIP_NESTED_ELECTRON_THEN_EXEC,
  stripNestedElectronEnv,
  wrapElectronAsNodeLaunch,
} from './nested-electron-env.js';

describe('nested-electron-env', () => {
  it('identifies Electron and Chrome keys', () => {
    expect(isNestedElectronEnvKey('ELECTRON_RUN_AS_NODE')).toBe(true);
    expect(isNestedElectronEnvKey('CHROME_CRASHPAD_PIPE_NAME')).toBe(true);
    expect(isNestedElectronEnvKey('PATH')).toBe(false);
    expect(isNestedElectronEnvKey('SIDEBOARD_APP_DATA')).toBe(false);
  });

  it('copies env and drops only Electron/Chrome keys', () => {
    expect(
      stripNestedElectronEnv({
        HOME: '/Users/me',
        ELECTRON_NO_ASAR: '1',
        CHROME_DESKTOP: 'Sideboard.desktop',
      }),
    ).toEqual({ HOME: '/Users/me' });
  });

  it('mutates a process-like env in place', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      CHROME_CRASHPAD_PIPE_NAME: 'pipe',
    };
    dropNestedElectronEnvFromProcess(env);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('wraps Electron-as-Node so crashpad env is unset before exec', () => {
    const wrapped = wrapElectronAsNodeLaunch('/Apps/Sideboard.app/MacOS/Sideboard', [
      '/tmp/run-stdio.js',
    ]);
    if (process.platform === 'win32') {
      expect(wrapped).toEqual({
        file: '/Apps/Sideboard.app/MacOS/Sideboard',
        args: ['/tmp/run-stdio.js'],
      });
      return;
    }
    expect(wrapped.file).toBe('/bin/sh');
    expect(wrapped.args[0]).toBe('-c');
    expect(wrapped.args[1]).toBe(STRIP_NESTED_ELECTRON_THEN_EXEC);
    expect(wrapped.args[1]).toContain('unset');
    expect(wrapped.args[1]).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(wrapped.args.slice(2)).toEqual([
      'sh',
      '/Apps/Sideboard.app/MacOS/Sideboard',
      '/tmp/run-stdio.js',
    ]);
  });

  it('actually unsets crashpad env before exec', () => {
    if (process.platform === 'win32') return;
    const out = execFileSync(
      '/bin/sh',
      ['-c', STRIP_NESTED_ELECTRON_THEN_EXEC, 'sh', '/usr/bin/printenv'],
      {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: '/tmp',
          CHROME_CRASHPAD_PIPE_NAME: 'pipe',
          ELECTRON_NO_ASAR: '1',
          SIDEBOARD_APP_DATA: '/tmp/data',
        },
        encoding: 'utf8',
      },
    );
    expect(out).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(out).toContain('SIDEBOARD_APP_DATA=/tmp/data');
    expect(out).not.toMatch(/^CHROME_CRASHPAD_PIPE_NAME=/m);
    expect(out).not.toMatch(/^ELECTRON_NO_ASAR=/m);
  });
});
