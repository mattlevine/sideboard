import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIGHTSY_MCP_ALLOWED_TOOLS,
  SIDEBOARD_MCP_ALLOWED_TOOLS,
  brightsyMcpAllowedTools,
  buildInjectedMcpServers,
  isBrightsyConnected,
  promptMentionsBrightsy,
  shouldInjectBrightsyMcp,
  threadRequestsBrightsyMcp,
  resolveSideboardMcpServer,
  toCodexMcpConfigArgs,
  toCursorMcpServers,
  toOpencodeMcpConfigContent,
  writeMcpServersConfig,
} from './injected-mcp.js';
import { brightsyMcpServerName } from '../brightsy/connected-teams.js';
import { wrapElectronAsNodeLaunch } from '../hook/nested-electron-env.js';

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
    // (absolute node from PATH). Never Sideboard.app / Electron-as-Node when node exists.
    if (servers[0]!.command === 'sideboard') {
      expect(servers[0]!.args).toEqual(['mcp']);
    } else {
      expect(
        servers[0]!.command === 'node' || /[/\\]node$/.test(servers[0]!.command),
      ).toBe(true);
      expect(servers[0]!.args?.some((a) => /run-stdio\.(js|cjs)$|cli[/\\]dist[/\\]index\.js$/.test(a))).toBe(
        true,
      );
      expect(servers[0]!.command).not.toMatch(/Sideboard\.app/);
      expect(servers[0]!.command).not.toBe('/bin/sh');
      expect(JSON.stringify(servers[0])).not.toContain('ELECTRON_RUN_AS_NODE');
    }

    const { toCursorMcpServers, toCodexMcpConfigArgs, toOpencodeMcpConfigContent, writeMcpServersConfig } =
      await import('./injected-mcp.js');
    // Dev/desktop app-data must reach every agent MCP serializer (Codex was the
    // regression: stripped env → wrong ~/Library/.../sideboard store).
    expect(servers[0]!.env?.SIDEBOARD_APP_DATA).toBeTruthy();
    expect(servers[0]!.env?.SIDEBOARD_MCP_PROFILE).toBe('worktree');
    expect(servers[0]!.env?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(servers[0]!.env?.GH_PROMPT_DISABLED).toBe('1');

    const cursorMap = toCursorMcpServers(servers);
    expect(cursorMap.sideboard?.type).toBe('stdio');
    if (process.platform === 'win32') {
      expect(cursorMap.sideboard?.command).toBe(servers[0]!.command);
    } else {
      expect(cursorMap.sideboard?.command).not.toMatch(/cursor-electron-as-node\.sh$/);
      expect(cursorMap.sideboard?.command).not.toBe('/bin/sh');
      expect(cursorMap.sideboard?.command).not.toMatch(/Sideboard\.app/);
      expect(JSON.stringify(cursorMap.sideboard)).not.toContain('ELECTRON_RUN_AS_NODE');
    }
    expect(cursorMap.sideboard?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
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

  it('prefers extraResources MCP over the asar/core dist copy', async () => {
    const proc = process as NodeJS.Process & { resourcesPath?: string };
    const previous = proc.resourcesPath;
    const root = mkdtempSync(join(tmpdir(), 'sideboard-mcp-packaged-'));
    try {
      const mcp = join(root, 'sideboard-mcp', 'core-dist', 'mcp', 'run-stdio.js');
      mkdirSync(join(mcp, '..'), { recursive: true });
      writeFileSync(mcp, '');
      proc.resourcesPath = root;
      const { findSideboardMcpJsEntry } = await import('./injected-mcp.js');
      expect(findSideboardMcpJsEntry()).toBe(mcp);
    } finally {
      if (previous === undefined) delete proc.resourcesPath;
      else proc.resourcesPath = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves Cursor MCP as real node, never Sideboard.app, when system node exists', async () => {
    const server = await resolveSideboardMcpServer();
    expect(server.command).not.toMatch(/Sideboard\.app/i);
    expect(server.command).not.toBe('/bin/sh');
    expect(JSON.stringify(server)).not.toContain('ELECTRON_RUN_AS_NODE');
    const cursor = toCursorMcpServers([server]);
    expect(cursor.sideboard?.command).not.toMatch(/Sideboard\.app/i);
    expect(cursor.sideboard?.command).not.toMatch(/cursor-electron-as-node\.sh$/);
    expect(JSON.stringify(cursor.sideboard)).not.toContain('ELECTRON_RUN_AS_NODE');
  });

  it('injects SIDEBOARD_ORCHESTRATOR_THREAD_ID for orchestration turns', async () => {
    const servers = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: false,
      orchestratorThreadId: 'orch-thread-123',
    });
    expect(servers[0]!.env?.SIDEBOARD_ORCHESTRATOR_THREAD_ID).toBe('orch-thread-123');
    expect(servers[0]!.env?.SIDEBOARD_MCP_PROFILE).toBe('orchestration');
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
    expect(servers[0]!.env?.SIDEBOARD_MCP_PROFILE).toBe('worktree');
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

describe('shouldInjectBrightsyMcp', () => {
  it('matches explicit Brightsy asks in the user prompt', () => {
    expect(promptMentionsBrightsy('use Brightsy to update the homepage')).toBe(
      true,
    );
    expect(promptMentionsBrightsy('Ask Brightsy for the blog posts')).toBe(true);
    expect(promptMentionsBrightsy('fix the sidebar')).toBe(false);
    expect(promptMentionsBrightsy('brightsy-ai-examples is the repo')).toBe(
      false,
    );
  });

  it('does not inject on worktree coding turns without a Brightsy ask', () => {
    expect(
      shouldInjectBrightsyMcp(
        { messages: [{ role: 'user', text: 'fix the sidebar', ts: '' }] },
        { connected: true, alwaysOnWorktree: false },
      ),
    ).toBe(false);
  });

  it('injects when the current user message names Brightsy', () => {
    expect(
      shouldInjectBrightsyMcp(
        {
          messages: [
            { role: 'user', text: 'use Brightsy to update the homepage', ts: '' },
          ],
        },
        { connected: true, alwaysOnWorktree: false },
      ),
    ).toBe(true);
  });

  it('stays on after a prior Brightsy ask or Brightsy MCP tool', () => {
    expect(
      threadRequestsBrightsyMcp({
        messages: [
          { role: 'user', text: 'use Brightsy to list posts', ts: '' },
          { role: 'agent', text: 'done', ts: '' },
          { role: 'user', text: 'now add a hero image', ts: '' },
        ],
      }),
    ).toBe(true);
    expect(
      threadRequestsBrightsyMcp({
        messages: [
          {
            role: 'agent',
            text: 'listing',
            ts: '',
            parts: [
              {
                type: 'tool',
                id: 't1',
                name: 'mcp__brightsy_acme__list_record_types',
                status: 'done',
              },
            ],
          },
          { role: 'user', text: 'publish the draft', ts: '' },
        ],
      }),
    ).toBe(true);
  });

  it('stays on after present_schema/present_files with Brightsy datasource', () => {
    expect(
      threadRequestsBrightsyMcp({
        messages: [
          {
            role: 'agent',
            text: '',
            ts: '',
            parts: [
              {
                type: 'tool',
                id: 's1',
                name: 'mcp__sideboard__present_schema',
                input: { datasource: 'brightsy', title: 'Posts' },
                status: 'done',
              },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      threadRequestsBrightsyMcp({
        messages: [
          {
            role: 'agent',
            text: '',
            ts: '',
            parts: [
              {
                type: 'tool',
                id: 's1',
                name: 'mcp__sideboard__present_schema',
                input: { datasource: 'inline', title: 'Local' },
                status: 'done',
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it('ignores agent prose that echoes the artifact reminder', () => {
    expect(
      threadRequestsBrightsyMcp({
        messages: [
          { role: 'user', text: 'make a page', ts: '' },
          {
            role: 'agent',
            text: 'CMS forms/tables: MCP present_schema (Brightsy resource_id).',
            ts: '',
          },
        ],
      }),
    ).toBe(false);
  });

  it('always injects for orchestrators when connected, never when logged out', () => {
    expect(
      shouldInjectBrightsyMcp(
        { messages: [{ role: 'user', text: 'list threads', ts: '' }] },
        { connected: true, orchestrator: true, alwaysOnWorktree: false },
      ),
    ).toBe(true);
    expect(
      shouldInjectBrightsyMcp(
        {
          messages: [
            { role: 'user', text: 'use Brightsy to update the homepage', ts: '' },
          ],
        },
        { connected: false, alwaysOnWorktree: true },
      ),
    ).toBe(false);
  });

  it('injects on every worktree turn when the always-on setting is enabled', () => {
    expect(
      shouldInjectBrightsyMcp(
        { messages: [{ role: 'user', text: 'fix the sidebar', ts: '' }] },
        { connected: true, alwaysOnWorktree: true },
      ),
    ).toBe(true);
  });
});

describe('toCursorMcpServers', () => {
  beforeEach(() => {
    vi.stubEnv('SIDEBOARD_APP_DATA', mkdtempSync(join(tmpdir(), 'sideboard-mcp-')));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves a real node launch unwrapped', () => {
    const map = toCursorMcpServers([
      {
        name: 'sideboard',
        command: '/opt/homebrew/bin/node',
        args: ['/tmp/run-stdio.js'],
        env: { SIDEBOARD_APP_DATA: '/tmp/data', ELECTRON_RUN_AS_NODE: '1' },
      },
    ]);
    expect(map.sideboard?.type).toBe('stdio');
    expect(map.sideboard?.command).toBe('/opt/homebrew/bin/node');
    expect(map.sideboard?.args).toEqual(['/tmp/run-stdio.js']);
    expect(map.sideboard?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(map.sideboard?.env?.SIDEBOARD_APP_DATA).toBe('/tmp/data');
  });

  it('does not wrap Sideboard.app behind a cursor-electron-as-node.sh script', () => {
    if (process.platform === 'win32') return;
    const electron = '/Applications/Sideboard.app/Contents/MacOS/Sideboard';
    const map = toCursorMcpServers([
      {
        name: 'sideboard',
        command: electron,
        args: ['/tmp/run-stdio.js'],
      },
    ]);
    expect(map.sideboard?.command).toBe(electron);
    expect(map.sideboard?.command).not.toMatch(/cursor-electron-as-node\.sh$/);
    expect(map.sideboard?.args).toEqual(['/tmp/run-stdio.js']);
  });

  it('unwraps an already-stripped /bin/sh Electron launch instead of wrapping it', () => {
    if (process.platform === 'win32') return;
    const wrapped = wrapElectronAsNodeLaunch(
      '/Applications/Sideboard.app/Contents/MacOS/Sideboard',
      ['/tmp/run-stdio.js'],
    );
    const map = toCursorMcpServers([
      { name: 'sideboard', command: wrapped.file, args: wrapped.args },
    ]);
    expect(map.sideboard?.command).not.toMatch(/cursor-electron-as-node\.sh$/);
    expect(map.sideboard?.command).not.toBe('/bin/sh');
    expect(map.sideboard?.command).toMatch(/Sideboard$/);
  });
});

describe('Claude / Codex / OpenCode MCP serializers', () => {
  const nodeServer = {
    name: 'sideboard',
    command: '/opt/homebrew/bin/node',
    args: ['/tmp/run-stdio.js'],
    env: { SIDEBOARD_APP_DATA: '/tmp/data', ELECTRON_RUN_AS_NODE: '1' },
  };

  it('do not wrap real node or keep ELECTRON_RUN_AS_NODE in spawn env', () => {
    const claudePath = writeMcpServersConfig([nodeServer]);
    expect(claudePath).toBeTruthy();
    const claude = JSON.parse(readFileSync(claudePath!, 'utf8')) as {
      mcpServers: {
        sideboard: { command: string; args?: string[]; env?: Record<string, string> };
      };
    };
    expect(claude.mcpServers.sideboard.command).toBe('/opt/homebrew/bin/node');
    expect(claude.mcpServers.sideboard.args).toEqual(['/tmp/run-stdio.js']);
    expect(claude.mcpServers.sideboard.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(claude.mcpServers.sideboard.env?.SIDEBOARD_APP_DATA).toBe('/tmp/data');

    const codex = toCodexMcpConfigArgs([nodeServer]);
    expect(codex.some((a) => a.includes('ELECTRON_RUN_AS_NODE'))).toBe(false);
    expect(
      codex.some((a) => a === 'mcp_servers.sideboard.command="/opt/homebrew/bin/node"'),
    ).toBe(true);

    const oc = JSON.parse(toOpencodeMcpConfigContent([nodeServer])) as {
      mcp: {
        sideboard: { command: string[]; environment?: Record<string, string> };
      };
    };
    expect(oc.mcp.sideboard.command).toEqual(['/opt/homebrew/bin/node', '/tmp/run-stdio.js']);
    expect(oc.mcp.sideboard.environment?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(oc.mcp.sideboard.environment?.SIDEBOARD_APP_DATA).toBe('/tmp/data');
  });
});
