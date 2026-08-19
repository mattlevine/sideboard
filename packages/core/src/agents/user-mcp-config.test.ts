import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeSideboardIntoMcpServersJson,
  writeMergedMcpServersJson,
} from './user-mcp-config.js';

describe('user MCP config merge', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('upserts sideboard without clobbering other servers', () => {
    const next = mergeSideboardIntoMcpServersJson(
      {
        mcpServers: {
          other: { command: 'npx', args: ['-y', 'other-mcp'] },
        },
      },
      {
        command: '/opt/homebrew/bin/node',
        args: ['/app/Resources/sideboard-mcp/core-dist/mcp/run-stdio.js'],
        env: {
          SIDEBOARD_APP_DATA: '/Users/me/Library/Application Support/sideboard',
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
    );
    const servers = next.mcpServers as Record<
      string,
      { type?: string; command: string; args?: string[]; env?: Record<string, string> }
    >;
    expect(servers.other?.command).toBe('npx');
    expect(servers.sideboard?.type).toBe('stdio');
    expect(servers.sideboard?.command).toBe('/opt/homebrew/bin/node');
    expect(servers.sideboard?.args?.[0]).toMatch(
      /sideboard-mcp[/\\]core-dist[/\\]mcp[/\\]run-stdio\.js$/,
    );
    expect(servers.sideboard?.env?.SIDEBOARD_APP_DATA).toBe(
      '/Users/me/Library/Application Support/sideboard',
    );
    expect(servers.sideboard?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('writes merged JSON to an explicit path', () => {
    root = mkdtempSync(join(tmpdir(), 'sideboard-user-mcp-'));
    const cfg = join(root, '.cursor', 'mcp.json');
    mkdirSync(join(root, '.cursor'), { recursive: true });
    writeFileSync(
      cfg,
      `${JSON.stringify({ mcpServers: { keep: { command: 'keep' } } }, null, 2)}\n`,
    );
    writeMergedMcpServersJson(cfg, {
      command: '/usr/local/bin/node',
      args: ['/tmp/run-stdio.js'],
      env: { SIDEBOARD_APP_DATA: '/tmp/store' },
    });
    const parsed = JSON.parse(readFileSync(cfg, 'utf8')) as {
      mcpServers: { keep: { command: string }; sideboard: { command: string } };
    };
    expect(parsed.mcpServers.keep.command).toBe('keep');
    expect(parsed.mcpServers.sideboard.command).toBe('/usr/local/bin/node');
  });
});
