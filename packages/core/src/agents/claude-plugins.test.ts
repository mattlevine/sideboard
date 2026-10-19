import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listUserClaudeMcpServerEntries } from './orch-mcp-isolation.js';
import { claudePluginServerId, listEnabledClaudePluginMcpServers } from './claude-plugins.js';

describe('claude plugin mcp', () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = undefined;
  });

  it('loads an enabled plugin server under the Claude tool prefix', () => {
    home = mkdtempSync(join(tmpdir(), 'sb-plugin-'));
    const root = join(home, '.claude', 'plugins', 'cache', 'market', 'dice', '1.0.0');
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dice' }));
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          roll: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] },
        },
      }),
    );
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        plugins: { 'dice@market': [{ installPath: root, version: '1.0.0' }] },
      }),
    );
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'dice@market': true, 'off@market': false } }),
    );

    const servers = listEnabledClaudePluginMcpServers({ home });
    expect(claudePluginServerId('dice', 'roll')).toBe('plugin_dice_roll');
    expect(servers.plugin_dice_roll?.command).toBe('node');
    expect(servers.plugin_dice_roll?.args).toEqual([join(root, 'server.js')]);
    expect((servers.plugin_dice_roll?.env as { CLAUDE_PLUGIN_ROOT: string }).CLAUDE_PLUGIN_ROOT).toBe(
      root,
    );
  });

  it('lets a project opt-in win and a local opt-out win', () => {
    home = mkdtempSync(join(tmpdir(), 'sb-plugin-proj-'));
    const root = join(home, 'plugin');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ db: { command: '${CLAUDE_PLUGIN_ROOT}/db' } }),
    );
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'db@market': [{ installPath: root }] } }),
    );
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'db@market': false } }),
    );
    const project = join(home, 'repo');
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'db@market': true } }),
    );
    expect(Object.keys(listEnabledClaudePluginMcpServers({ home, projectDirs: [project] }))).toEqual([
      'plugin_db_db',
    ]);
    writeFileSync(
      join(project, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'db@market': false } }),
    );
    expect(listEnabledClaudePluginMcpServers({ home, projectDirs: [project] })).toEqual({});
  });

  it('merges plugin servers behind ~/.claude.json entries', () => {
    home = mkdtempSync(join(tmpdir(), 'sb-plugin-merge-'));
    const root = join(home, 'plugin');
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dice' }));
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { roll: { command: 'plugin' } } }),
    );
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'dice@market': [{ installPath: root }] } }),
    );
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'dice@market': true } }),
    );
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { gmail: { command: 'npx' }, sideboard: { command: 'node' }, plugin_dice_roll: { command: 'user' } },
      }),
    );
    expect(listUserClaudeMcpServerEntries(home)).toEqual({
      gmail: { command: 'npx' },
      plugin_dice_roll: { command: 'user' },
    });
  });
});
