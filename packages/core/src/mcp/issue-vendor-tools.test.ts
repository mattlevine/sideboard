import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('registerConnectedIssueVendorTools', () => {
  const prevHome = process.env.HOME;
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevVault === undefined) delete process.env.SIDEBOARD_SECRET_VAULT;
    else process.env.SIDEBOARD_SECRET_VAULT = prevVault;
    vi.resetModules();
  });

  async function load() {
    const home = mkdtempSync(join(tmpdir(), 'sb-issue-vendor-'));
    process.env.HOME = home;
    process.env.SIDEBOARD_APP_DATA = home;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
    return {
      settings: await import('../store/app-settings.js'),
      vendor: await import('./issue-vendor-tools.js'),
    };
  }

  function fakeServer() {
    const names: string[] = [];
    const server = {
      tool: (name: string) => {
        names.push(name);
      },
    } as unknown as McpServer;
    return { server, names };
  }

  it('registers GitHub issue tools when Linear and AbleTime are disconnected', async () => {
    const { vendor } = await load();
    const { server, names } = fakeServer();
    vendor.registerConnectedIssueVendorTools(server);
    expect(names).toContain('github_get_issue');
    expect(names).toContain('github_comment');
    expect(names).toContain('github_update_issue');
    expect(names).toContain('github_create_issue');
    expect(names).not.toContain('linear_search_issues');
    expect(names).not.toContain('abletime_orientation');
  });

  it('registers Linear tools only when Linear is connected', async () => {
    const { settings, vendor } = await load();
    settings.updateIntegrationsSettings({ linearApiKey: 'lin_api_test' });
    const { server, names } = fakeServer();
    vendor.registerConnectedIssueVendorTools(server);
    expect(names).toContain('github_get_issue');
    expect(names).toContain('linear_search_issues');
    expect(names).toContain('linear_get_issue');
    expect(names).not.toContain('abletime_orientation');
  });

  it('registers AbleTime tools only when AbleTime is connected', async () => {
    const { settings, vendor } = await load();
    settings.updateIntegrationsSettings({ abletimeAccessToken: 'apt_test' });
    const { server, names } = fakeServer();
    vendor.registerConnectedIssueVendorTools(server);
    expect(names).toContain('github_get_issue');
    expect(names).toContain('abletime_orientation');
    expect(names).toContain('abletime_ensure_task');
    expect(names).toContain('abletime_comment');
    expect(names).not.toContain('linear_search_issues');
  });
});
