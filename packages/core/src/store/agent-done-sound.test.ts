import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('agent-done custom sound', () => {
  let dataDir: string;
  let mod: typeof import('./agent-done-sound.js');

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-agent-done-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    vi.resetModules();
    mod = await import('./agent-done-sound.js');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('imports, reads, and clears a wav', () => {
    const src = join(dataDir, 'cheer.wav');
    // Minimal RIFF header + junk payload — import only checks size/ext.
    writeFileSync(src, Buffer.from('RIFF....WAVEfmt ', 'utf8'));

    const imported = mod.importAgentDoneCustomSound(src);
    expect(imported.name).toBe('cheer.wav');
    expect(imported.mime).toBe('audio/wav');
    expect(existsSync(imported.path)).toBe(true);
    expect(mod.findAgentDoneCustomSoundPath()).toBe(imported.path);

    const payload = mod.readAgentDoneCustomSound('cheer.wav');
    expect(payload?.mime).toBe('audio/wav');
    expect(payload?.name).toBe('cheer.wav');
    expect(payload?.dataBase64.length).toBeGreaterThan(0);

    mod.clearAgentDoneCustomSoundFile();
    expect(mod.findAgentDoneCustomSoundPath()).toBeNull();
    expect(mod.readAgentDoneCustomSound()).toBeNull();
  });

  it('rejects unsupported types', () => {
    const src = join(dataDir, 'notes.txt');
    writeFileSync(src, 'nope');
    expect(() => mod.importAgentDoneCustomSound(src)).toThrow(/Unsupported/);
  });
});
