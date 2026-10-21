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

  it('stores a relay URL and drops the account when the origin changes', async () => {
    delete process.env.SIDEBOARD_REMOTE_RELAY_URL;
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-relay-url-settings-'));
    const mod = await import('./app-settings.js');
    mod.updateIntegrationsSettings({
      remoteAccountToken: 'relay-token',
      remoteAccountEmail: 'ada@example.com',
      remoteRelayUrl: 'https://relay.example.com',
    });
    const saved = mod.loadAppSettings();
    expect(saved.integrations.remoteRelayUrl).toBe('wss://relay.example.com/remote');
    expect(saved.integrations.remoteAccountToken).toBeUndefined();
    expect(saved.integrations.remoteAccountEmail).toBeUndefined();
    const pub = mod.toPublicAppSettings(saved);
    expect(pub.integrations.remoteRelayUrl).toBe('wss://relay.example.com/remote');
    expect(pub.integrations.hasRemoteAccount).toBe(false);
  });

  it('keeps the account when the relay URL is the same origin', async () => {
    delete process.env.SIDEBOARD_REMOTE_RELAY_URL;
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-relay-url-same-'));
    const mod = await import('./app-settings.js');
    mod.updateIntegrationsSettings({
      remoteAccountToken: 'relay-token',
      remoteAccountEmail: 'ada@example.com',
    });
    const saved = mod.updateIntegrationsSettings({
      remoteRelayUrl: 'wss://relay.sideboard.cloud/remote',
    });
    expect(saved.integrations.remoteAccountToken).toBe('relay-token');
  });

  it('rejects a relay URL that is not the phone path', async () => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'sb-relay-url-bad-'));
    const mod = await import('./app-settings.js');
    expect(() => mod.updateIntegrationsSettings({ remoteRelayUrl: 'https://example.com/docs' })).toThrow(
      /WebSocket address/,
    );
  });
});
