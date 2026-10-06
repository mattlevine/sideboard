import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('read-aloud settings', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-read-aloud-settings-'));
    return import('./app-settings.js');
  }

  it('clamps rate and stores a voice URI', async () => {
    const mod = await load();
    expect(mod.loadAppSettings().advanced.readAloudRate).toBeUndefined();
    expect(mod.loadAppSettings().advanced.readAloudVoiceURI).toBeUndefined();
    expect(mod.updateAdvancedSettings({ readAloudRate: 1.7 }).advanced.readAloudRate).toBe(1.7);
    expect(mod.updateAdvancedSettings({ readAloudRate: 9 }).advanced.readAloudRate).toBe(3);
    expect(
      mod.updateAdvancedSettings({ readAloudVoiceURI: 'com.apple.voice.compact.en-US.Samantha' })
        .advanced.readAloudVoiceURI,
    ).toBe('com.apple.voice.compact.en-US.Samantha');
    expect(mod.updateAdvancedSettings({ readAloudVoiceURI: '' }).advanced.readAloudVoiceURI).toBe(
      undefined,
    );
  });
});
