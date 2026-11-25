import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const COMPUTER_USE_OFF =
  'Computer use is off. Turn it on in Settings → Advanced.';

export const COMPUTER_USE_DESCRIPTION =
  'Drive this Mac to test an app you started. Off unless Settings → Advanced → Computer use is on. action is screenshot, click, type, key, or scroll. screenshot writes a PNG under the worktree .context/cli/ and returns that path — read the image. click and scroll take screen points. type sends text. key is one key (return, tab, escape, arrows, delete, or one character) with optional modifiers command, shift, option, control. Use it to check behavior and visual design (hierarchy, alignment, spacing, type, contrast, fit with the surrounding surface). preview=window means the Electron window, not a browser tab. Sideboard needs Accessibility permission. Do not drive an app you did not start for this test.';

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

export type ComputerUseRunner = {
  screenshot: (file: string) => Promise<void>;
  runAppleScript: (script: string) => Promise<void>;
};

export type ComputerUseResult =
  | { ok: true; action: string; path?: string; message: string }
  | { ok: false; error: string };

export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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

function screenshotFile(cwd: string, now: number): string {
  const root = isAbsolute(cwd) ? cwd : tmpdir();
  const dir = join(root, '.context', 'cli');
  mkdirSync(dir, { recursive: true });
  return join(dir, `computer-use-${now}.png`);
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
      await opts.runner.screenshot(file);
      return {
        ok: true,
        action,
        path: file,
        message:
          'Screenshot saved. Read that PNG. Judge behavior and visual design: hierarchy, alignment, spacing, type, contrast, and fit with the surrounding surface.',
      };
    }
    if (action === 'click') {
      const x = finite(rec.x);
      const y = finite(rec.y);
      if (x === null || y === null) return { ok: false, error: 'click requires finite x and y' };
      const px = point(x);
      const py = point(y);
      if (px === null || py === null) return { ok: false, error: 'click point is out of range' };
      await opts.runner.runAppleScript(
        `tell application "System Events" to click at {${px}, ${py}}`,
      );
      return { ok: true, action, message: `Clicked ${px}, ${py}.` };
    }
    if (action === 'type') {
      const text = typeof rec.text === 'string' ? rec.text : '';
      if (!text) return { ok: false, error: 'type requires text' };
      if (text.length > 2000) return { ok: false, error: 'type text is longer than 2000 characters' };
      await opts.runner.runAppleScript(
        `tell application "System Events" to keystroke ${appleScriptString(text)}`,
      );
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
      const using = modifierClause(modifiers.map((name) => name.toLowerCase()));
      const code = KEY_CODES[key];
      const script =
        code !== undefined
          ? `tell application "System Events" to key code ${code}${using}`
          : key.length === 1
            ? `tell application "System Events" to keystroke ${appleScriptString(key)}${using}`
            : '';
      if (!script) return { ok: false, error: `unsupported key ${key}` };
      await opts.runner.runAppleScript(script);
      return { ok: true, action, message: `Pressed ${key}.` };
    }
    if (action === 'scroll') {
      const dx = finite(rec.dx) ?? 0;
      const dy = finite(rec.dy) ?? 0;
      if (dx === 0 && dy === 0) return { ok: false, error: 'scroll requires dx or dy' };
      const steps = Math.max(1, Math.min(12, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / 40)));
      const key = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
      const code = KEY_CODES[key];
      for (let i = 0; i < steps; i += 1) {
        await opts.runner.runAppleScript(
          `tell application "System Events" to key code ${code}`,
        );
      }
      return { ok: true, action, message: `Scrolled ${key} ${steps} step${steps === 1 ? '' : 's'}.` };
    }
    return { ok: false, error: 'action must be screenshot, click, type, key, or scroll' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function formatComputerUseHint(enabled: boolean): string {
  if (!enabled) {
    return 'Computer use is off (Settings → Advanced). You can start the Dev app, and you cannot click or type in the UI until that switch is on. Say what you could not see. A UI change is still judged for visual design from the diff and any screenshot you do have: hierarchy, alignment, spacing, type, contrast, and fit with the surrounding surface.';
  }
  return 'Computer use is on (Settings → Advanced). `computer_use` drives this Mac so you can test what you built. action is screenshot, click, type, key, or scroll. A screenshot is a PNG under `.context/cli/` — read that image. Judge behavior and visual design: hierarchy, alignment, spacing, type, contrast, and fit with the surrounding surface. `preview=window` means the Electron window, not a browser tab. Sideboard needs Accessibility permission. Do not drive an app you did not start for this test.';
}

export const macosComputerUseRunner: ComputerUseRunner = {
  async screenshot(file) {
    await execFileAsync('screencapture', ['-x', file]);
  },
  async runAppleScript(script) {
    await execFileAsync('osascript', ['-e', script]);
  },
};
