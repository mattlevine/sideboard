import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isInjectedOrchMcpName,
  listMcpNamesFromCodexToml,
  listMcpNamesFromJsonMap,
  listUserCodexMcpNames,
  listUserCursorMcpNames,
  listUserOpencodeMcpNames,
  toCodexDisableUserMcpArgs,
  userMcpNamesToDisable,
} from './orch-mcp-isolation.js';

describe('orch MCP isolation', () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = undefined;
  });

  it('keeps Sideboard / Brightsy and drops user Linear', () => {
    expect(isInjectedOrchMcpName('sideboard')).toBe(true);
    expect(isInjectedOrchMcpName('brightsy_acme')).toBe(true);
    expect(
      userMcpNamesToDisable({
        injectedNames: ['sideboard', 'brightsy_acme'],
        names: ['sideboard', 'linear', 'gmail', 'brightsy_acme'],
      }),
    ).toEqual(['linear', 'gmail']);
  });

  it('parses Codex toml and OpenCode / Cursor JSON maps', () => {
    expect(
      listMcpNamesFromCodexToml(`
[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
[mcp_servers.sideboard]
command = "node"
`),
    ).toEqual(['linear', 'sideboard']);
    expect(
      listMcpNamesFromJsonMap({ mcp: { linear: { enabled: true }, docs: {} } }, 'mcp'),
    ).toEqual(['linear', 'docs']);
    expect(
      listMcpNamesFromJsonMap({ mcpServers: { linear: { command: 'npx' } } }, 'mcpServers'),
    ).toEqual(['linear']);
  });

  it('reads user Codex / OpenCode names from a fake home without rewriting them', () => {
    home = mkdtempSync(join(tmpdir(), 'sideboard-orch-mcp-'));
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\n',
    );
    writeFileSync(
      join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ mcp: { linear: { type: 'remote', url: 'https://mcp.linear.app/mcp' } } }),
    );
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { linear: { command: 'npx' } } }),
    );
    expect(listUserCodexMcpNames(home)).toEqual(['linear']);
    expect(listUserOpencodeMcpNames(home)).toEqual(['linear']);
    expect(listUserCursorMcpNames(home)).toEqual(['linear']);
    expect(toCodexDisableUserMcpArgs(['linear', 'bad.name'])).toEqual([
      '-c',
      'mcp_servers.linear.enabled=false',
    ]);
  });
});
