import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENCODE_PLUGIN_SOURCE, writeOpencodeRpcPlugin } from './opencode-hook.js';
import { PILOT_TOOL_NAMES } from './pilot-tools.js';
import { AGENT_RPC_TOKEN_ENV, AGENT_RPC_URL_ENV } from './protocol.js';

describe('OpenCode Agent RPC plugin', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = join(tmpdir(), `sideboard-opencode-rpc-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes a plugin that registers the pilot tools over WebSocket RPC', () => {
    const pluginFile = writeOpencodeRpcPlugin();
    expect(pluginFile).toBe(join(dataDir, 'agent-rpc', 'opencode', 'sideboard-rpc.js'));
    const src = readFileSync(pluginFile, 'utf8');
    expect(src).toBe(OPENCODE_PLUGIN_SOURCE);
    for (const name of PILOT_TOOL_NAMES) {
      expect(src).toContain(name);
    }
    expect(src).toContain('ui.presentArtifact');
    expect(src).toContain('job.wait');
    expect(src).toContain('job.stop');
    expect(src).toContain('new WebSocket');
    expect(src).toContain('new URL(RPC_URL)');
    expect(src).not.toContain('const URL =');
    expect(src).toContain('searchParams.set("authToken", TOKEN)');
    expect(src).not.toContain('sideboard mcp');
  });

  it('opens the RPC socket with the global URL constructor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-opencode-plugin-'));
    try {
      const shim = join(dir, 'plugin-shim.mjs');
      writeFileSync(
        shim,
        [
          'function chain() { const node = { describe() { return node }, optional() { return node } }; return node }',
          'export function tool(def) { return def }',
          'tool.schema = { string: () => chain(), enum: () => chain() }',
        ].join('\n'),
      );
      const pluginPath = join(dir, 'sideboard-rpc.mjs');
      writeFileSync(
        pluginPath,
        OPENCODE_PLUGIN_SOURCE.replace(
          'import { tool } from "@opencode-ai/plugin"',
          `import { tool } from ${JSON.stringify(pathToFileURL(shim).href)}`,
        ),
      );
      const runner = join(dir, 'run.mjs');
      writeFileSync(
        runner,
        `
          const seen = [];
          globalThis.WebSocket = class FakeSocket {
            constructor(url) { seen.push(url); queueMicrotask(() => this.listeners.get('open')?.()); }
            listeners = new Map();
            addEventListener(type, fn) { this.listeners.set(type, fn); }
            send(data) {
              const msg = JSON.parse(data);
              this.listeners.get('message')?.({ data: JSON.stringify({ id: msg.id, result: { ok: true } }) });
            }
            close() {}
          };
          const { SideboardRpc } = await import(${JSON.stringify(pathToFileURL(pluginPath).href)});
          const plugin = await SideboardRpc({ directory: '/tmp' });
          const raw = await plugin.tool.present_artifact.execute({ title: 't', type: 'markdown', content: 'hi' });
          process.stdout.write(JSON.stringify({ seen, raw }));
        `,
      );
      const result = spawnSync(process.execPath, [runner], {
        encoding: 'utf8',
        env: {
          ...process.env,
          [AGENT_RPC_URL_ENV]: 'ws://127.0.0.1:9/agent-rpc',
          [AGENT_RPC_TOKEN_ENV]: 'tok',
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout) as { seen: string[]; raw: string };
      expect(parsed.seen[0]).toMatch(/^ws:\/\/127\.0\.0\.1:9\/agent-rpc\?/);
      expect(parsed.seen[0]).toContain('authToken=tok');
      expect(parsed.raw).toContain('"ok":true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
