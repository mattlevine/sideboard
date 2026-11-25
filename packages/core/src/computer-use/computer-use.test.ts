import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  appleScriptString,
  performComputerUse,
  type ComputerUseRunner,
} from './computer-use.js';

function runner(): ComputerUseRunner & { scripts: string[]; shots: string[] } {
  const scripts: string[] = [];
  const shots: string[] = [];
  return {
    scripts,
    shots,
    screenshot: vi.fn(async (file: string) => {
      shots.push(file);
    }),
    runAppleScript: vi.fn(async (script: string) => {
      scripts.push(script);
    }),
  };
}

describe('performComputerUse', () => {
  it('refuses when the Advanced setting is off and does not touch the screen', async () => {
    const fake = runner();
    const result = await performComputerUse({
      enabled: false,
      cwd: '/tmp/wt',
      input: { action: 'click', x: 1, y: 2 },
      runner: fake,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Settings → Advanced/);
    expect(fake.scripts).toEqual([]);
    expect(fake.shots).toEqual([]);
  });

  it('writes a screenshot path and does not echo pixels', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'computer-use-'));
    const fake = runner();
    const result = await performComputerUse({
      enabled: true,
      cwd,
      input: { action: 'screenshot' },
      runner: fake,
      now: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(join(cwd, '.context', 'cli', 'computer-use-42.png'));
      expect(result.message).toMatch(/visual design/);
    }
    expect(fake.shots).toEqual([join(cwd, '.context', 'cli', 'computer-use-42.png')]);
  });

  it('clicks with integer screen points', async () => {
    const fake = runner();
    const result = await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'click', x: 10.2, y: 20.8 },
      runner: fake,
    });
    expect(result.ok).toBe(true);
    expect(fake.scripts).toEqual(['tell application "System Events" to click at {10, 21}']);
  });

  it('escapes typed quotes', async () => {
    const fake = runner();
    await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'type', text: 'say "hi"' },
      runner: fake,
    });
    expect(fake.scripts[0]).toBe(
      `tell application "System Events" to keystroke ${appleScriptString('say "hi"')}`,
    );
    expect(fake.scripts[0]).toContain('\\"hi\\"');
  });

  it('rejects an unknown action', async () => {
    const fake = runner();
    const result = await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'shell' },
      runner: fake,
    });
    expect(result.ok).toBe(false);
    expect(fake.scripts).toEqual([]);
  });
});
