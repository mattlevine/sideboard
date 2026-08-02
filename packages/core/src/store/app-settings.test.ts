import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('app settings', () => {
  const prevHome = process.env.HOME;
  let home: string;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    home = mkdtempSync(join(tmpdir(), 'sb-app-settings-'));
    process.env.HOME = home;
    return import('./app-settings.js');
  }

  it('round-trips environment vars and drops empties', async () => {
    const mod = await load();
    const saved = mod.updateAppEnvironment({
      CURSOR_API_KEY: 'cursor_test',
      ANTHROPIC_API_KEY: '',
      CODEX_API_KEY: 'codex_test',
    });
    expect(saved.environment).toEqual({
      CURSOR_API_KEY: 'cursor_test',
      CODEX_API_KEY: 'codex_test',
    });
    expect(mod.loadAppSettings().environment.CURSOR_API_KEY).toBe('cursor_test');

    const cleared = mod.updateAppEnvironment({ CURSOR_API_KEY: null });
    expect(cleared.environment.CURSOR_API_KEY).toBeUndefined();
  });

  it('applyAppEnvironment fills gaps without overwriting host env', async () => {
    const mod = await load();
    mod.saveAppSettings({
      environment: { CURSOR_API_KEY: 'from-settings', EXTRA: 'yes' },
      claude: {},
      brightsy: {},
    });
    const target: NodeJS.ProcessEnv = { CURSOR_API_KEY: 'from-shell' };
    mod.applyAppEnvironment(target);
    expect(target.CURSOR_API_KEY).toBe('from-shell');
    expect(target.EXTRA).toBe('yes');
  });

  it('reads legacy/malformed files safely', async () => {
    const mod = await load();
    writeFileSync(mod.appSettingsPath(), '{not json', 'utf8');
    expect(mod.loadAppSettings()).toEqual({
      environment: {},
      claude: {},
      brightsy: {},
    });
  });

  it('round-trips Brightsy cloud connect settings', async () => {
    const mod = await load();
    const saved = mod.updateBrightsySettings({
      cloudConnectEnabled: true,
      cloudConnectAgent: 'codex',
    });
    expect(saved.brightsy).toEqual({
      cloudConnectEnabled: true,
      cloudConnectAgent: 'codex',
    });
    expect(mod.brightsyCloudConnectEnabled()).toBe(true);
    expect(mod.brightsyCloudConnectAgent()).toBe('codex');

    const cleared = mod.updateBrightsySettings({
      cloudConnectEnabled: false,
      cloudConnectAgent: null,
    });
    expect(cleared.brightsy.cloudConnectEnabled).toBe(false);
    expect(cleared.brightsy.cloudConnectAgent).toBeUndefined();
    expect(mod.brightsyCloudConnectAgent()).toBe('claude');
  });

  it('round-trips Claude harness settings', async () => {
    const mod = await load();
    const saved = mod.updateClaudeSettings({
      executablePath: '/custom/bin/claude',
      chromeEnabled: true,
    });
    expect(saved.claude).toEqual({
      executablePath: '/custom/bin/claude',
      chromeEnabled: true,
    });
    expect(mod.resolveClaudeExecutable()).toBe('/custom/bin/claude');
    expect(mod.claudeChromeEnabled()).toBe(true);

    const cleared = mod.updateClaudeSettings({ executablePath: null, chromeEnabled: false });
    expect(cleared.claude.executablePath).toBeUndefined();
    expect(cleared.claude.chromeEnabled).toBe(false);
    expect(mod.resolveClaudeExecutable()).toBe('claude');
  });

  it('preserves environment when updating Claude settings', async () => {
    const mod = await load();
    mod.updateAppEnvironment({ ANTHROPIC_API_KEY: 'sk-test' });
    const next = mod.updateClaudeSettings({ chromeEnabled: true });
    expect(next.environment.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(next.claude.chromeEnabled).toBe(true);
  });
});
