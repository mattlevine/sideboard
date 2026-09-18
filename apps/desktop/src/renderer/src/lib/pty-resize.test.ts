import { describe, expect, it } from 'vitest';
import { shouldApplyPtyResize } from './pty-resize';

describe('shouldApplyPtyResize', () => {
  it('skips unchanged and invalid sizes so the prompt is not reprinted', () => {
    expect(shouldApplyPtyResize(null, { cols: 80, rows: 24 })).toBe(true);
    expect(shouldApplyPtyResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(
      false,
    );
    expect(shouldApplyPtyResize({ cols: 80, rows: 24 }, { cols: 120, rows: 30 })).toBe(
      true,
    );
    expect(shouldApplyPtyResize(null, { cols: 0, rows: 24 })).toBe(false);
    expect(shouldApplyPtyResize(null, { cols: 80, rows: -1 })).toBe(false);
    expect(shouldApplyPtyResize(null, { cols: Number.NaN, rows: 24 })).toBe(false);
  });
});
