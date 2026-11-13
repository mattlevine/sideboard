import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('max orchestration threads', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-orch-threads-'));
    return import('./app-settings.js');
  }

  it('defaults to 5 and clamps to 1–32', async () => {
    const mod = await load();
    expect(mod.maxOrchThreads()).toBe(5);
    expect(mod.updateAdvancedSettings({ maxOrchThreads: 12 }).advanced.maxOrchThreads).toBe(12);
    expect(mod.maxOrchThreads()).toBe(12);
    expect(mod.updateAdvancedSettings({ maxOrchThreads: 0 }).advanced.maxOrchThreads).toBe(1);
    expect(mod.updateAdvancedSettings({ maxOrchThreads: 99 }).advanced.maxOrchThreads).toBe(32);
    expect(mod.updateAdvancedSettings({ maxOrchThreads: 3.8 }).advanced.maxOrchThreads).toBe(3);
    expect(mod.loadAppSettings().advanced.maxOrchThreads).toBe(3);
  });
});
