import { desktopCapturer, screen, shell, systemPreferences } from 'electron';
import {
  computerUseBridgePath,
  computerUseEnabled,
  readComputerUseBridge,
  type ComputerUseInput,
} from '@sideboard-ai/core';
import { postComputerUseEvent } from './cg-events';
import {
  closeComputerUseBridge,
  listenComputerUseBridge,
  type RunningComputerUseBridge,
} from './computer-use-server';

let running: RunningComputerUseBridge | null = null;
let starting: Promise<void> | null = null;
let generation = 0;

const ALLOW_CONTROL = 'Allow Sideboard to control this Mac, then try again.';
const ALLOW_SCREEN = 'Allow Sideboard to record the screen, then try again.';
const SCREEN_SETTINGS =
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture';

function promptComputerUseAccess(opts: { accessibility: boolean; screen: boolean }): void {
  if (process.platform !== 'darwin') return;
  if (opts.accessibility) {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch {
      // The event path reports the failure.
    }
  }
  if (!opts.screen) return;
  try {
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return;
    void shell.openExternal(SCREEN_SETTINGS);
  } catch {
    // ignore
  }
}

async function captureMainDisplay(): Promise<{ png: Buffer; scale: number }> {
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    throw new Error(ALLOW_SCREEN);
  }
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const width = Math.max(1, Math.round(display.size.width * scale));
  const height = Math.max(1, Math.round(display.size.height * scale));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
  const png = source?.thumbnail.toPNG();
  if (!png || png.length < 24) throw new Error(ALLOW_SCREEN);
  return { png, scale };
}

function postEvent(event: ComputerUseInput): void {
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    throw new Error(ALLOW_CONTROL);
  }
  postComputerUseEvent(event);
}

async function anotherAppIsPosting(): Promise<boolean> {
  const info = readComputerUseBridge();
  if (!info) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(300),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function syncComputerUseFromPatch(patch: { computerUse?: boolean }): void {
  if (!('computerUse' in patch)) return;
  const on = patch.computerUse === true;
  syncComputerUseBridge({ accessibility: on, screen: on });
}

export function syncComputerUseBridge(opts: { accessibility: boolean; screen: boolean }): void {
  if (process.platform !== 'darwin') return;
  if (!computerUseEnabled()) {
    stopComputerUseBridge();
    return;
  }
  promptComputerUseAccess(opts);
  if (running || starting) return;
  const gen = generation;
  starting = anotherAppIsPosting()
    .then((busy) => {
      if (busy || gen !== generation) return null;
      return listenComputerUseBridge({ postEvent, capturePng: captureMainDisplay });
    })
    .then((bridge) => {
      starting = null;
      if (!bridge || gen !== generation) {
        if (bridge) closeComputerUseBridge(bridge);
        return;
      }
      running = bridge;
    })
    .catch((err: unknown) => {
      starting = null;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`computer use bridge failed: ${message}`);
    });
}

export function stopComputerUseBridge(): void {
  generation += 1;
  const current = running;
  running = null;
  starting = null;
  if (current) closeComputerUseBridge(current, computerUseBridgePath());
}
