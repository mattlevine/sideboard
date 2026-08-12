import { readFileSync } from 'node:fs';
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

  it('includes sideboard when requested (absolute node entry when CLI not on PATH)', async () => {
    const servers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: false,
    });
    expect(servers).toHaveLength(1);
    expect(servers[0]!.name).toBe('sideboard');
    // Dev machines without a global `sideboard` binary get `node <abs>/mcp/run-stdio.js`
    // (absolute node from PATH, or Electron-as-Node for asar installs).
    if (servers[0]!.command === 'sideboard') {
      expect(servers[0]!.args).toEqual(['mcp']);
    } else {
      expect(
        servers[0]!.command === 'node' ||
          /[/\\]node$/.test(servers[0]!.command) ||
          servers[0]!.command === process.execPath,
      ).toBe(true);
      expect(servers[0]!.args?.[0]).toMatch(/run-stdio\.(js|cjs)$|cli[/\\]dist[/\\]index\.js$/);
    }

    const { toCursorMcpServers, toCodexMcpConfigArgs, toOpencodeMcpConfigContent, writeMcpServersConfig } =
      await import('./injected-mcp.js');
    // Dev/desktop app-data must reach every agent MCP serializer (Codex was the
    // regression: stripped env → wrong ~/Library/.../sideboard store).
    expect(servers[0]!.env?.SIDEBOARD_APP_DATA).toBeTruthy();

    const cursorMap = toCursorMcpServers(servers);
    expect(cursorMap.sideboard?.command).toBe(servers[0]!.command);
    expect(cursorMap.sideboard?.env?.SIDEBOARD_APP_DATA).toBe(
      servers[0]!.env!.SIDEBOARD_APP_DATA,
    );

    const codexArgs = toCodexMcpConfigArgs(servers);
    expect(codexArgs).toContain('-c');
    expect(codexArgs.some((a) => a.startsWith('mcp_servers.sideboard.command='))).toBe(
      true,
    );
    expect(
      codexArgs.some(
        (a) => a === 'mcp_servers.sideboard.default_tools_approval_mode="approve"',
      ),
    ).toBe(true);
    expect(codexArgs.some((a) => a === 'mcp_servers.sideboard.tool_timeout_sec=300')).toBe(
      true,
    );
    expect(
      codexArgs.some((a) =>
        a.includes('mcp_servers.sideboard.env.SIDEBOARD_APP_DATA='),
      ),
    ).toBe(true);

    const oc = JSON.parse(toOpencodeMcpConfigContent(servers)) as {
      mcp: {
        sideboard: {
          type: string;
          command: string[];
          environment?: Record<string, string>;
        };
      };
    };
    expect(oc.mcp.sideboard.type).toBe('local');
    expect(oc.mcp.sideboard.command[0]).toBe(servers[0]!.command);
    expect(oc.mcp.sideboard.environment?.SIDEBOARD_APP_DATA).toBe(
      servers[0]!.env!.SIDEBOARD_APP_DATA,
    );

    const claudeCfgPath = writeMcpServersConfig(servers);
    expect(claudeCfgPath).toBeTruthy();
    const claudeCfg = JSON.parse(readFileSync(claudeCfgPath!, 'utf8')) as {
      mcpServers: { sideboard: { env?: Record<string, string> } };
    };
    expect(claudeCfg.mcpServers.sideboard.env?.SIDEBOARD_APP_DATA).toBe(
      servers[0]!.env!.SIDEBOARD_APP_DATA,
    );
  });

  it('resolves MCP entry without throwing when import.meta.url is unavailable', async () => {
    const { findSideboardMcpJsEntry } = await import('./injected-mcp.js');
    expect(() => findSideboardMcpJsEntry()).not.toThrow();
  });

  it('injects SIDEBOARD_ORCHESTRATOR_THREAD_ID for orchestration turns', async () => {
    const servers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: false,
      orchestratorThreadId: 'orch-thread-123',
    });
    expect(servers[0]!.env?.SIDEBOARD_ORCHESTRATOR_THREAD_ID).toBe('orch-thread-123');
    expect(servers[0]!.env?.SIDEBOARD_APP_DATA).toBeTruthy();
    const { toCodexMcpConfigArgs } = await import('./injected-mcp.js');
    const args = toCodexMcpConfigArgs(servers);
    expect(
      args.some((a) =>
        a.includes('mcp_servers.sideboard.env.SIDEBOARD_ORCHESTRATOR_THREAD_ID='),
      ),
    ).toBe(true);
    expect(
      args.some((a) =>
        a.includes('mcp_servers.sideboard.env.SIDEBOARD_APP_DATA='),
      ),
    ).toBe(true);
  });

  it('always injects SIDEBOARD_APP_DATA for Sideboard MCP', async () => {
    const servers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: false,
    });
    expect(servers[0]!.env?.SIDEBOARD_APP_DATA).toBeTruthy();
    expect(servers[0]!.env?.SIDEBOARD_ORCHESTRATOR_THREAD_ID).toBeUndefined();
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
