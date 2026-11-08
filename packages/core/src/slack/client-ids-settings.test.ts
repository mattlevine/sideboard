import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('slack client ids in settings', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  it('keeps every client id across a reload', async () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-slack-clients-'));
    const mod = await import('../store/app-settings.js');
    const saved = mod.updateIntegrationsSettings({
      slackClientIds: [' 111.aaa ', '222.bbb', '111.aaa', ''],
    });
    expect(saved.integrations.slackClientIds).toEqual(['111.aaa', '222.bbb']);
    expect(mod.toPublicAppSettings(saved).integrations.slackClientIds).toEqual([
      '111.aaa',
      '222.bbb',
    ]);
    vi.resetModules();
    const again = await import('../store/app-settings.js');
    expect(again.loadAppSettings().integrations.slackClientIds).toEqual(['111.aaa', '222.bbb']);
    const cleared = again.updateIntegrationsSettings({ slackClientIds: [] });
    expect(cleared.integrations.slackClientIds).toBeUndefined();
  });
});
