import { describe, expect, it } from 'vitest';
import {
  caffeinateIndicatorReasons,
  caffeinateIndicatorTooltip,
  caffeinateTrayIconBitmap,
  paintCaffeinateDockBadge,
  rgbaToPng,
} from './caffeinate-indicator';

describe('caffeinateIndicatorReasons', () => {
  const off = {
    holdHeld: false,
    whileRunning: false,
    agentsRunning: 0,
    whileSlackListen: false,
    slackListenRunning: false,
  };

  it('is empty when nothing is keeping the Mac awake', () => {
    expect(caffeinateIndicatorReasons(off)).toEqual([]);
    expect(
      caffeinateIndicatorReasons({ ...off, whileRunning: true, agentsRunning: 0 }),
    ).toEqual([]);
    expect(
      caffeinateIndicatorReasons({ ...off, whileSlackListen: true, slackListenRunning: false }),
    ).toEqual([]);
  });

  it('includes every active source', () => {
    expect(caffeinateIndicatorReasons({ ...off, holdHeld: true })).toEqual(['chat']);
    expect(
      caffeinateIndicatorReasons({ ...off, whileRunning: true, agentsRunning: 2 }),
    ).toEqual(['running']);
    expect(
      caffeinateIndicatorReasons({ ...off, whileSlackListen: true, slackListenRunning: true }),
    ).toEqual(['slack']);
    expect(
      caffeinateIndicatorReasons({
        holdHeld: true,
        whileRunning: true,
        agentsRunning: 1,
        whileSlackListen: true,
        slackListenRunning: true,
      }),
    ).toEqual(['chat', 'running', 'slack']);
  });
});

describe('caffeinateIndicatorTooltip', () => {
  it('names the sources', () => {
    expect(caffeinateIndicatorTooltip([])).toBe('');
    expect(caffeinateIndicatorTooltip(['chat'])).toBe(
      'Sideboard is keeping this Mac awake (orchestration chat)',
    );
    expect(caffeinateIndicatorTooltip(['chat', 'slack'])).toBe(
      'Sideboard is keeping this Mac awake (orchestration chat and Slack Listen)',
    );
  });
});

describe('paintCaffeinateDockBadge', () => {
  it('paints a yellow dot in the bottom-right', () => {
    const width = 64;
    const buf = Buffer.alloc(width * width * 4, 0);
    paintCaffeinateDockBadge(buf, width, width, { bgra: false });
    const side = width;
    const radius = side * 0.18;
    const inset = side * 0.08;
    const cx = Math.round(width - radius - inset);
    const cy = Math.round(width - radius - inset);
    const i = (cy * width + cx) * 4;
    expect([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]).toEqual([255, 196, 40, 255]);
    expect(buf[0]).toBe(0);
  });

  it('swizzles to BGRA for macOS dock bitmaps', () => {
    const width = 64;
    const buf = Buffer.alloc(width * width * 4, 0);
    paintCaffeinateDockBadge(buf, width, width, { bgra: true });
    const radius = width * 0.18;
    const inset = width * 0.08;
    const cx = Math.round(width - radius - inset);
    const cy = Math.round(width - radius - inset);
    const i = (cy * width + cx) * 4;
    expect([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]).toEqual([40, 196, 255, 255]);
  });
});

describe('rgbaToPng', () => {
  it('writes a PNG signature', () => {
    const png = rgbaToPng(Buffer.alloc(4, 255), 1, 1);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

describe('paintCaffeinateTrayIcon', () => {
  it('paints a yellow dot', () => {
    const size = 44;
    const buf = caffeinateTrayIconBitmap(size);
    const i = (22 * size + 22) * 4;
    expect([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]).toEqual([255, 196, 40, 255]);
    expect(buf[3]).toBe(0);
  });
});
