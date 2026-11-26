import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  appleScriptString,
  performComputerUse,
  typeScripts,
  pngPointSize,
  pointGeometry,
  scrollWheelSwift,
  type ComputerUseRunner,
  type ScreenshotCapture,
} from './computer-use.js';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function png(opts: { width: number; height: number; ppm?: number }): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = 8;
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (opts.ppm !== undefined) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(opts.ppm, 0);
    phys.writeUInt32BE(opts.ppm, 4);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function runner(): ComputerUseRunner & {
  scripts: string[];
  shots: string[];
  scrolls: Array<[number, number, number, number]>;
} {
  const scripts: string[] = [];
  const shots: string[] = [];
  const scrolls: Array<[number, number, number, number]> = [];
  const capture: ScreenshotCapture = { pixelWidth: 200, pixelHeight: 100, scale: 2 };
  return {
    scripts,
    shots,
    scrolls,
    screenshot: vi.fn(async (file: string) => {
      shots.push(file);
      return capture;
    }),
    runAppleScript: vi.fn(async (script: string) => {
      scripts.push(script);
    }),
    scroll: vi.fn(async (x: number, y: number, dx: number, dy: number) => {
      scrolls.push([x, y, dx, dy]);
    }),
  };
}

describe('pngPointSize', () => {
  it('turns a 2× pHYs PNG into point size', () => {
    const ppm = Math.round(144 / 0.0254);
    const info = pngPointSize(png({ width: 3456, height: 2234, ppm }));
    expect(pointGeometry(info)).toEqual({ width: 1728, height: 1117, scale: 2 });
  });

  it('treats a PNG without pHYs as scale 1', () => {
    const info = pngPointSize(png({ width: 800, height: 600 }));
    expect(pointGeometry(info)).toEqual({ width: 800, height: 600, scale: 1 });
  });
});

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
    expect(fake.scrolls).toEqual([]);
  });

  it('returns point size and scale so clicks are not PNG pixels', async () => {
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
      expect(result.width).toBe(100);
      expect(result.height).toBe(50);
      expect(result.scale).toBe(2);
      expect(result.message).toMatch(/scale 2/);
      expect(result.message).toMatch(/screen points/);
    }
    expect(fake.shots).toEqual([join(cwd, '.context', 'cli', 'computer-use-42.png')]);
  });

  it('skips osascript when Sideboard posts the click', async () => {
    const fake = runner();
    const posted: unknown[] = [];
    fake.postInput = async (event) => {
      posted.push(event);
      return true;
    };
    const result = await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'click', x: 10.2, y: 20.8 },
      runner: fake,
    });
    expect(result.ok).toBe(true);
    expect(posted).toEqual([{ type: 'click', x: 10, y: 21 }]);
    expect(fake.scripts).toEqual([]);
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

  it('scrolls with a wheel event at the point', async () => {
    const fake = runner();
    const result = await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'scroll', x: 10.2, y: 20.4, dx: 40, dy: 80.2 },
      runner: fake,
    });
    expect(result.ok).toBe(true);
    expect(fake.scripts).toEqual([]);
    expect(fake.scrolls).toEqual([[10, 20, 40, 80]]);
    expect(scrollWheelSwift(10, 20, 40, 80)).toContain('wheel1: -80, wheel2: -40');
    expect(scrollWheelSwift(10, 20, 40, 80)).toContain('CGPoint(x: 10, y: 20)');
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

  it('types a newline as return between lines', async () => {
    const fake = runner();
    await performComputerUse({
      enabled: true,
      cwd: '/tmp/wt',
      input: { action: 'type', text: 'say "hi"\nnext' },
      runner: fake,
    });
    expect(fake.scripts).toEqual(typeScripts('say "hi"\nnext'));
    expect(fake.scripts[1]).toBe('tell application "System Events" to key code 36');
    expect(fake.scripts.every((script) => !script.includes('\n'))).toBe(true);
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
    expect(fake.scrolls).toEqual([]);
  });
});
