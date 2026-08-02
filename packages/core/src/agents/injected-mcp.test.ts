import { describe, expect, it } from 'vitest';
import {
  BRIGHTSY_MCP_ALLOWED_TOOLS,
  SIDEBOARD_MCP_ALLOWED_TOOLS,
  brightsyMcpAllowedTools,
  buildInjectedMcpServers,
  isBrightsyConnected,
} from './injected-mcp.js';
import { brightsyMcpServerName } from '../brightsy/connected-teams.js';

describe('injected-mcp', () => {
  it('exports allow-tool wildcards', () => {
    expect(SIDEBOARD_MCP_ALLOWED_TOOLS).toContain('mcp__sideboard__*');
    expect(BRIGHTSY_MCP_ALLOWED_TOOLS).toContain('mcp__brightsy__*');
  });

  it('builds allow tools per server name', () => {
    expect(brightsyMcpAllowedTools(['brightsy_acme', 'brightsy_beta'])).toEqual([
      'mcp__brightsy_acme',
      'mcp__brightsy_acme__*',
      'mcp__brightsy_beta',
      'mcp__brightsy_beta__*',
    ]);
  });

  it('sanitizes MCP server names from slugs', () => {
    expect(brightsyMcpServerName('acme-corp')).toBe('brightsy_acme-corp');
    expect(brightsyMcpServerName('Acme Corp!')).toBe('brightsy_Acme_Corp');
  });

  it('includes sideboard when requested', async () => {
    const servers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: false,
    });
    expect(servers).toEqual([
      { name: 'sideboard', command: 'sideboard', args: ['mcp'] },
    ]);
  });

  it('skips brightsy when not connected', async () => {
    // If the developer machine has Brightsy logged in this still may include it —
    // assert shape only when connected, otherwise empty for Brightsy-only.
    const servers = await buildInjectedMcpServers({
      includeSideboard: false,
      includeBrightsy: true,
    });
    if (!isBrightsyConnected()) {
      expect(servers).toEqual([]);
    } else {
      // Either legacy `brightsy` or one+ `brightsy_<slug>` from Sideboard store.
      expect(servers.length).toBeGreaterThan(0);
      for (const s of servers) {
        expect(s.name === 'brightsy' || s.name.startsWith('brightsy_')).toBe(true);
        expect(['brightsy-mcp', 'npx']).toContain(s.command);
      }
    }
  });
});
