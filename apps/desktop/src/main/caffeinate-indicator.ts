import { deflateSync } from 'node:zlib';

export type CaffeinateReason = 'chat' | 'running' | 'slack' | 'schedules';

export function caffeinateIndicatorReasons(opts: {
  holdHeld: boolean;
  whileRunning: boolean;
  agentsRunning: number;
  whileSlackListen: boolean;
  slackListenRunning: boolean;
  whileSchedules: boolean;
  schedulesEnabled: boolean;
}): CaffeinateReason[] {
  const reasons: CaffeinateReason[] = [];
  if (opts.holdHeld) reasons.push('chat');
  if (opts.whileRunning && opts.agentsRunning > 0) reasons.push('running');
  if (opts.whileSlackListen && opts.slackListenRunning) reasons.push('slack');
  if (opts.whileSchedules && opts.schedulesEnabled) reasons.push('schedules');
  return reasons;
}

const LABELS: Record<CaffeinateReason, string> = {
  chat: 'orchestration chat',
  running: 'agents running',
  slack: 'Slack Listen',
  schedules: 'scheduled tasks',
};

export function caffeinateIndicatorTooltip(reasons: CaffeinateReason[]): string {
  if (reasons.length === 0) return '';
  const labels = reasons.map((r) => LABELS[r]);
  if (labels.length === 1) {
    return `Sideboard is keeping this Mac awake (${labels[0]})`;
  }
  const last = labels[labels.length - 1];
  return `Sideboard is keeping this Mac awake (${labels.slice(0, -1).join(', ')} and ${last})`;
}

const DOT_YELLOW = [255, 196, 40] as const;
const DOT_RING = [22, 16, 8] as const;

function putPixelAt(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rgb: readonly [number, number, number],
  bgra: boolean,
  alpha = 255,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  if (bgra) {
    bitmap[i] = rgb[2];
    bitmap[i + 1] = rgb[1];
    bitmap[i + 2] = rgb[0];
  } else {
    bitmap[i] = rgb[0];
    bitmap[i + 1] = rgb[1];
    bitmap[i + 2] = rgb[2];
  }
  bitmap[i + 3] = alpha;
}

/** Solid yellow status dot (dark ring so it reads on light or dark chrome). */
export function paintYellowDot(
  bitmap: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  opts?: { bgra?: boolean },
): void {
  const bgra = Boolean(opts?.bgra);
  const rRing = radius;
  const rFill = radius * 0.78;
  const rRing2 = rRing * rRing;
  const rFill2 = rFill * rFill;
  const x0 = Math.max(0, Math.floor(cx - rRing));
  const x1 = Math.min(width - 1, Math.ceil(cx + rRing));
  const y0 = Math.max(0, Math.floor(cy - rRing));
  const y1 = Math.min(height - 1, Math.ceil(cy + rRing));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > rRing2) continue;
      putPixelAt(
        bitmap,
        width,
        height,
        x,
        y,
        d2 > rFill2 ? DOT_RING : DOT_YELLOW,
        bgra,
      );
    }
  }
}

/** Menu-bar: compact yellow dot. */
export function paintCaffeinateTrayIcon(bitmap: Buffer, size: number): void {
  const r = size * 0.36;
  paintYellowDot(bitmap, size, size, (size - 1) / 2, (size - 1) / 2, r);
}

export function caffeinateTrayIconBitmap(size = 44): Buffer {
  const bitmap = Buffer.alloc(size * size * 4, 0);
  paintCaffeinateTrayIcon(bitmap, size);
  return bitmap;
}

/**
 * Smaller yellow status dot in the dock-icon corner.
 * Electron `toBitmap`/`createFromBitmap` on macOS is BGRA — pass `bgra: true`.
 */
export function paintCaffeinateDockBadge(
  bitmap: Buffer,
  width: number,
  height: number,
  opts?: { bgra?: boolean },
): void {
  const side = Math.min(width, height);
  const radius = side * 0.18;
  const inset = side * 0.08;
  paintYellowDot(
    bitmap,
    width,
    height,
    width - radius - inset,
    height - radius - inset,
    radius,
    opts,
  );
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG so Electron keeps true color (bitmap APIs are BGRA on macOS). */
export function rgbaToPng(rgba: Buffer, width: number, height: number): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function caffeinateTrayPng(size = 44): Buffer {
  return rgbaToPng(caffeinateTrayIconBitmap(size), size, size);
}
