import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('account default autonomy', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-autonomy-'));
    return import('./app-settings.js');
  }

  it('defaults new-chat autonomy to full and round-trips an explicit choice', async () => {
    const mod = await load();
    expect(mod.getDefaultAutonomy()).toBe('full');
    expect(mod.resolveThreadDefaults().autonomy).toBe('full');
    expect(mod.resolveOrchestratorDefaults().autonomy).toBe('full');

    const saved = mod.updateDefaultsSettings({ autonomy: 'default' });
    expect(saved.defaults.autonomy).toBe('default');
    expect(mod.getDefaultAutonomy()).toBe('default');
    expect(mod.resolveNewThreadOptions({}).autonomy).toBe('default');

    const orch = mod.updateDefaultsSettings({ orchestrator: { autonomy: 'full' } });
    expect(orch.defaults.orchestrator).toEqual({ autonomy: 'full' });
    expect(mod.resolveOrchestratorDefaults().autonomy).toBe('full');
    expect(mod.resolveThreadDefaults().autonomy).toBe('default');

    const cleared = mod.updateDefaultsSettings({
      autonomy: null,
      orchestrator: { autonomy: null },
    });
    expect(cleared.defaults.autonomy).toBeUndefined();
    expect(cleared.defaults.orchestrator).toBeUndefined();
    expect(mod.getDefaultAutonomy()).toBe('full');
    expect(mod.resolveOrchestratorDefaults().autonomy).toBe('full');

    const ignored = mod.updateDefaultsSettings({ autonomy: 'bypass' as never });
    expect(ignored.defaults.autonomy).toBeUndefined();
  });
});
