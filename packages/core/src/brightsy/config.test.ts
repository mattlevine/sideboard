import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('brightsyConfigPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honors BRIGHTSY_CONFIG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-brightsy-cfg-'));
    const path = join(dir, 'config.json');
    vi.stubEnv('BRIGHTSY_CONFIG', path);
    writeFileSync(
      path,
      JSON.stringify({ access_token: 't', account_id: 'a' }),
    );
    const { brightsyConfigPath, loadBrightsyConfig } = await import('./config.js');
    expect(brightsyConfigPath()).toBe(path);
    expect(loadBrightsyConfig().access_token).toBe('t');
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats BRIGHTSY_CONFIG as ~/.brightsy when it is a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-brightsy-cfgdir-'));
    vi.stubEnv('BRIGHTSY_CONFIG', dir);
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ access_token: 't', account_id: 'a' }),
    );
    const { brightsyConfigPath, loadBrightsyConfig, saveBrightsyConfig } =
      await import('./config.js');
    expect(brightsyConfigPath()).toBe(join(dir, 'config.json'));
    expect(loadBrightsyConfig().access_token).toBe('t');
    saveBrightsyConfig({
      access_token: 't2',
      account_id: 'a',
    });
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).access_token).toBe(
      't2',
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates ~/.brightsy when saving a new session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-brightsy-home-'));
    const cfgDir = join(home, '.brightsy');
    vi.stubEnv('BRIGHTSY_CONFIG', join(cfgDir, 'config.json'));
    const { saveBrightsyConfig, loadBrightsyConfig } = await import('./config.js');
    saveBrightsyConfig({ access_token: 't', account_id: 'a' });
    expect(loadBrightsyConfig().access_token).toBe('t');
    rmSync(home, { recursive: true, force: true });
  });
});
