import { describe, expect, it } from 'vitest';
import {
  dropNestedElectronEnvFromProcess,
  isNestedElectronEnvKey,
  stripNestedElectronEnv,
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
});
