import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENCODE_PLUGIN_SOURCE, writeOpencodeRpcPlugin } from './opencode-hook.js';
import { PILOT_TOOL_NAMES } from './pilot-tools.js';

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
    const { configDir, pluginFile } = writeOpencodeRpcPlugin();
    expect(configDir).toBe(join(dataDir, 'agent-rpc', 'opencode'));
    const src = readFileSync(pluginFile, 'utf8');
    expect(src).toBe(OPENCODE_PLUGIN_SOURCE);
    for (const name of PILOT_TOOL_NAMES) {
      expect(src).toContain(name);
    }
    expect(src).toContain('ui.presentArtifact');
    expect(src).toContain('job.wait');
    expect(src).toContain('job.stop');
    expect(src).toContain('new WebSocket');
    expect(src).not.toContain('sideboard mcp');
  });
});
