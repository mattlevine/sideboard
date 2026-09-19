import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAgentHostEnvKey,
  sanitizeAgentHostEnv,
  stripHostToolingPath,
} from './agent-host-env.js';

describe('isAgentHostEnvKey', () => {
  it('drops electron-vite / pnpm host keys but keeps Sideboard store + PATH', () => {
    expect(isAgentHostEnvKey('NODE_PATH')).toBe(true);
    expect(isAgentHostEnvKey('INIT_CWD')).toBe(true);
    expect(isAgentHostEnvKey('npm_package_name')).toBe(true);
    expect(isAgentHostEnvKey('npm_config_store_dir')).toBe(true);
    expect(isAgentHostEnvKey('PNPM_STORE_DIR')).toBe(true);
    expect(isAgentHostEnvKey('SIDEBOARD_WORKSPACE_PATH')).toBe(true);
    expect(isAgentHostEnvKey('SIDEBOARD_PORT_1')).toBe(true);
    expect(isAgentHostEnvKey('CONDUCTOR_WORKSPACE_PATH')).toBe(true);
    expect(isAgentHostEnvKey('PORT')).toBe(true);
    expect(isAgentHostEnvKey('SIDEBOARD_APP_DATA')).toBe(false);
    expect(isAgentHostEnvKey('PATH')).toBe(false);
    expect(isAgentHostEnvKey('HOME')).toBe(false);
  });
});

describe('stripHostToolingPath', () => {
  it('removes worktree node_modules/.bin and electron-vite bins', () => {
    const path = [
      '/wt/apps/desktop/node_modules/.bin',
      '/wt/node_modules/.bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/pnpm/node-gyp-bin',
    ].join(delimiter);
    expect(stripHostToolingPath(path).split(delimiter)).toEqual([
      '/opt/homebrew/bin',
      '/usr/bin',
    ]);
  });
});

describe('sanitizeAgentHostEnv', () => {
  it('clears host tooling and pins PWD/INIT_CWD to the worktree', () => {
    const env: NodeJS.ProcessEnv = {
      HOME: '/Users/me',
      SIDEBOARD_APP_DATA: '/tmp/dev-app-data',
      NODE_PATH: '/wt/node_modules/electron-vite/node_modules',
      INIT_CWD: '/wt/sideboard',
      PWD: '/wt/apps/desktop',
      PORT: '53177',
      SIDEBOARD_WORKSPACE_PATH: '/wt/sideboard',
      SIDEBOARD_ROOT_PATH: '/Projects/sideboard',
      npm_package_name: '@sideboard-ai/desktop',
      npm_lifecycle_event: 'dev',
      PNPM_STORE_DIR: '/wt/.context/pkg-cache',
      PATH: ['/wt/node_modules/.bin', '/opt/homebrew/bin'].join(delimiter),
    };
    sanitizeAgentHostEnv(env, '/tmp/monterrey');
    expect(env.HOME).toBe('/Users/me');
    expect(env.SIDEBOARD_APP_DATA).toBe('/tmp/dev-app-data');
    expect(env.NODE_PATH).toBeUndefined();
    expect(env.npm_package_name).toBeUndefined();
    expect(env.PORT).toBeUndefined();
    expect(env.SIDEBOARD_WORKSPACE_PATH).toBeUndefined();
    expect(env.PWD).toBe('/tmp/monterrey');
    expect(env.INIT_CWD).toBe('/tmp/monterrey');
    expect(env.PATH).toBe('/opt/homebrew/bin');
  });
});
