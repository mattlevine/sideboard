import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import {
  cgScrollWheels,
  fetchComputerUseScreenshot,
  postComputerUseBridge,
  type ComputerUseInput,
} from './bridge.js';

const execFileAsync = promisify(execFile);

export const COMPUTER_USE_OFF =
  'Computer use is off. Turn it on in Settings → Advanced.';

export const COMPUTER_USE_DESCRIPTION =
  'Drive this Mac to test an app you started. Off unless Settings → Advanced → Computer use is on. action is screenshot, click, type, key, or scroll. screenshot writes a PNG of the main display under the worktree .context/cli/ and returns that path plus point width, height, and scale. Read the image. x and y are screen points from the top-left of that image, not PNG pixels: divide a pixel by scale. click and scroll use those points. scroll posts a wheel event at the point (positive dx is right, positive dy is down). type sends text. key is one key (return, tab, escape, arrows, delete, or one character) with optional modifiers command, shift, option, control. Use it to check behavior and visual design (hierarchy, alignment, spacing, type, contrast, fit with the surrounding surface). preview=window means the Electron window, not a browser tab. Clicks, typing, scrolling, and screenshots are posted by Sideboard after macOS allows Sideboard to control this Mac and record the screen. Do not drive an app you did not start for this test.';

const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  escape: 53,
  esc: 53,
  delete: 51,
  backspace: 51,
  forwarddelete: 117,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
};

const MODIFIERS = new Set(['command', 'cmd', 'shift', 'option', 'alt', 'control', 'ctrl']);

export function macKeyCode(key: string): number | null {
  const code = KEY_CODES[key];
  return code === undefined ? null : code;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ScreenshotCapture = {
  pixelWidth: number;
  pixelHeight: number;
  /** PNG pixels per screen point (1 on a non-Retina display, 2 on a typical Mac). */
  scale: number;
};

export type ComputerUseRunner = {
  screenshot: (file: string) => Promise<ScreenshotCapture>;
  runAppleScript: (script: string) => Promise<void>;
  scroll: (x: number, y: number, dx: number, dy: number) => Promise<void>;
  /**
   * True when Sideboard posted the event. False when that bridge is down,
   * and the osascript / swift path runs instead.
   */
  postInput?: (event: ComputerUseInput) => Promise<boolean>;
};

export type ComputerUseResult =
  | {
      ok: true;
      action: string;
      path?: string;
      width?: number;
      height?: number;
      scale?: number;
      message: string;
    }
  | { ok: false; error: string };

export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** One `osascript -e` statement per line. A raw newline is not a legal `-e` script. */
export function typeScripts(text: string): string[] {
  const parts = text.split(/\r\n|\n|\r/);
  const scripts: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]) {
      scripts.push(`tell application "System Events" to keystroke ${appleScriptString(parts[i])}`);
    }
    if (i < parts.length - 1) {
      scripts.push('tell application "System Events" to key code 36');
    }
  }
  return scripts;
}

export function modifierClause(modifiers: string[]): string {
  const downs = modifiers.map((name) => {
    if (name === 'cmd' || name === 'command') return 'command down';
    if (name === 'alt' || name === 'option') return 'option down';
    if (name === 'ctrl' || name === 'control') return 'control down';
    return 'shift down';
  });
  if (!downs.length) return '';
  return ` using {${downs.join(', ')}}`;
}

/**
 * Pixel size and backing scale from a PNG `screencapture` wrote.
 * pHYs in pixels-per-meter becomes scale = dpi / 72. Missing pHYs is scale 1.
 */
export function pngPointSize(bytes: Buffer): ScreenshotCapture {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('screenshot is not a PNG');
  }
  let pixelWidth = 0;
  let pixelHeight = 0;
  let scale = 1;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = offset + 8;
    if (data + length > bytes.length) break;
    if (type === 'IHDR' && length >= 8) {
      pixelWidth = bytes.readUInt32BE(data);
      pixelHeight = bytes.readUInt32BE(data + 4);
    } else if (type === 'pHYs' && length >= 9 && bytes[data + 8] === 1) {
      const ppm = bytes.readUInt32BE(data);
      if (ppm > 0) scale = (ppm * 0.0254) / 72;
    } else if (type === 'IEND') {
      break;
    }
    offset = data + length + 4;
  }
  if (pixelWidth <= 0 || pixelHeight <= 0) throw new Error('screenshot PNG has no size');
  return { pixelWidth, pixelHeight, scale };
}

export function pointGeometry(info: ScreenshotCapture): {
  width: number;
  height: number;
  scale: number;
} {
  const raw = info.scale > 0 && Number.isFinite(info.scale) ? info.scale : 1;
  const scale = Math.round(raw * 100) / 100;
  return {
    width: Math.round(info.pixelWidth / scale),
    height: Math.round(info.pixelHeight / scale),
    scale,
  };
}

/**
 * Positive dx/dy are right/down. CGEvent wheel1 positive scrolls up, so both
 * axes are negated. Integers only — they are interpolated into the script.
 */
export function scrollWheelSwift(x: number, y: number, dx: number, dy: number): string {
  for (const n of [x, y, dx, dy]) {
    if (!Number.isInteger(n)) throw new Error('scroll coordinates must be integers');
  }
  const { wheel1, wheel2 } = cgScrollWheels(dx, dy);
  return `import CoreGraphics
let src = CGEventSource(stateID: .hidSystemState)
let p = CGPoint(x: ${x}, y: ${y})
if let move = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) {
  move.post(tap: .cghidEventTap)
}
if let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: ${wheel1}, wheel2: ${wheel2}, wheel3: 0) {
  ev.location = p
  ev.post(tap: .cghidEventTap)
}
`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function point(value: number): number | null {
  const n = Math.round(value);
  if (n < -8000 || n > 20000) return null;
  return n;
}

function scrollDelta(value: number): number | null {
  const n = Math.round(value);
  if (n < -4000 || n > 4000) return null;
  return n;
}

function screenshotFile(cwd: string, now: number): string {
  const root = isAbsolute(cwd) ? cwd : tmpdir();
  const dir = join(root, '.context', 'cli');
  mkdirSync(dir, { recursive: true });
  return join(dir, `computer-use-${now}.png`);
}

async function posted(runner: ComputerUseRunner, event: ComputerUseInput): Promise<boolean> {
  if (!runner.postInput) return false;
  return runner.postInput(event);
}

function screenshotMessage(width: number, height: number, scale: number): string {
  return `Screenshot saved (main display). Read that PNG. x and y are screen points from the top-left of this image, not PNG pixels. Divide a pixel by scale ${scale}. Point size is ${width}×${height}. Judge behavior and visual design: hierarchy, alignment, spacing, type, contrast, and fit with the surrounding surface.`;
}

export async function performComputerUse(opts: {
  enabled: boolean;
  cwd: string;
  input: unknown;
  runner: ComputerUseRunner;
  now?: number;
}): Promise<ComputerUseResult> {
  if (!opts.enabled) return { ok: false, error: COMPUTER_USE_OFF };
  const rec = asRecord(opts.input);
  const action = typeof rec.action === 'string' ? rec.action : '';
  try {
    if (action === 'screenshot') {
      const file = screenshotFile(opts.cwd, opts.now ?? Date.now());
      const captured = await opts.runner.screenshot(file);
      const geo = pointGeometry(captured);
      return {
        ok: true,
        action,
        path: file,
        width: geo.width,
        height: geo.height,
        scale: geo.scale,
        message: screenshotMessage(geo.width, geo.height, geo.scale),
      };
    }
    if (action === 'click') {
      const x = finite(rec.x);
      const y = finite(rec.y);
      if (x === null || y === null) return { ok: false, error: 'click requires finite x and y' };
      const px = point(x);
      const py = point(y);
      if (px === null || py === null) return { ok: false, error: 'click point is out of range' };
      if (!(await posted(opts.runner, { type: 'click', x: px, y: py }))) {
        await opts.runner.runAppleScript(
          `tell application "System Events" to click at {${px}, ${py}}`,
        );
      }
      return { ok: true, action, message: `Clicked ${px}, ${py}.` };
    }
    if (action === 'type') {
      const text = typeof rec.text === 'string' ? rec.text : '';
      if (!text) return { ok: false, error: 'type requires text' };
      if (text.length > 2000) return { ok: false, error: 'type text is longer than 2000 characters' };
      if (!(await posted(opts.runner, { type: 'type', text }))) {
        for (const script of typeScripts(text)) {
          await opts.runner.runAppleScript(script);
        }
      }
      return { ok: true, action, message: `Typed ${text.length} characters.` };
    }
    if (action === 'key') {
      const key = typeof rec.key === 'string' ? rec.key.trim().toLowerCase() : '';
      const modifiers = Array.isArray(rec.modifiers)
        ? rec.modifiers.filter((item): item is string => typeof item === 'string')
        : [];
      if (!key) return { ok: false, error: 'key requires key' };
      if (modifiers.some((name) => !MODIFIERS.has(name.toLowerCase()))) {
        return { ok: false, error: 'key modifiers are command, shift, option, and control' };
      }
      const mods = modifiers.map((name) => name.toLowerCase());
      const using = modifierClause(mods);
      const code = macKeyCode(key);
      const script =
        code !== null
          ? `tell application "System Events" to key code ${code}${using}`
          : key.length === 1
            ? `tell application "System Events" to keystroke ${appleScriptString(key)}${using}`
            : '';
      if (!script) return { ok: false, error: `unsupported key ${key}` };
      if (!(await posted(opts.runner, { type: 'key', key, modifiers: mods }))) {
        await opts.runner.runAppleScript(script);
      }
      return { ok: true, action, message: `Pressed ${key}.` };
    }
    if (action === 'scroll') {
      const x = finite(rec.x);
      const y = finite(rec.y);
      if (x === null || y === null) return { ok: false, error: 'scroll requires finite x and y' };
      const px = point(x);
      const py = point(y);
      if (px === null || py === null) return { ok: false, error: 'scroll point is out of range' };
      const dx = finite(rec.dx) ?? 0;
      const dy = finite(rec.dy) ?? 0;
      const sdx = scrollDelta(dx);
      const sdy = scrollDelta(dy);
      if (sdx === null || sdy === null) return { ok: false, error: 'scroll delta is out of range' };
      if (sdx === 0 && sdy === 0) return { ok: false, error: 'scroll requires dx or dy' };
      if (!(await posted(opts.runner, { type: 'scroll', x: px, y: py, dx: sdx, dy: sdy }))) {
        await opts.runner.scroll(px, py, sdx, sdy);
      }
      return {
        ok: true,
        action,
        message: `Scrolled at ${px}, ${py} by ${sdx}, ${sdy}. Positive dx is right, positive dy is down.`,
      };
    }
    return { ok: false, error: 'action must be screenshot, click, type, key, or scroll' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function formatComputerUseHint(enabled: boolean): string {
  if (!enabled) {
    return 'Computer use is off (Settings → Advanced). Say the visual pass was not seen.';
  }
  return 'Computer use is on. Screenshot returns scale; x and y are screen points (divide a PNG pixel by scale). Scroll is a wheel event at that point.';
}

export const macosComputerUseRunner: ComputerUseRunner = {
  async screenshot(file) {
    const via = await fetchComputerUseScreenshot();
    if (via) {
      writeFileSync(file, via.png);
      const info = pngPointSize(via.png);
      return { ...info, scale: via.scale > 0 ? via.scale : info.scale };
    }
    await execFileAsync('screencapture', ['-x', '-m', file]);
    return pngPointSize(readFileSync(file));
  },
  async runAppleScript(script) {
    await execFileAsync('osascript', ['-e', script]);
  },
  async scroll(x, y, dx, dy) {
    await execFileAsync('swift', ['-e', scrollWheelSwift(x, y, dx, dy)]);
  },
  postInput(event) {
    return postComputerUseBridge(event);
  },
};
