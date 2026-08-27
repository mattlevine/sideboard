import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
