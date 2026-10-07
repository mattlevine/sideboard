import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('relay account settings', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  it('vaults the relay account token and keeps the email label', async () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-relay-account-settings-'));
    const mod = await import('./app-settings.js');
    const saved = mod.updateIntegrationsSettings({
      remoteAccountToken: 'relay-token',
      remoteAccountEmail: 'Ada@Example.com',
    });
    expect(saved.integrations.remoteAccountToken).toBe('relay-token');
    expect(saved.integrations.remoteAccountEmail).toBe('ada@example.com');
    const pub = mod.toPublicAppSettings(mod.loadAppSettings());
    expect('remoteAccountToken' in pub.integrations).toBe(false);
    expect(pub.integrations.hasRemoteAccount).toBe(true);
    expect(pub.integrations.remoteAccountEmail).toBe('ada@example.com');
    expect(mod.loadAppSettings().integrations.remoteAccountToken).toBe('relay-token');
  });
});
