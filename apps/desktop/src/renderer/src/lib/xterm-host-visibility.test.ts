import { describe, expect, it } from 'vitest';
import { xtermHostVisibility } from './xterm-host-visibility';

describe('xtermHostVisibility', () => {
  it('stays hidden while parked even after xterm is ready', () => {
    expect(xtermHostVisibility(true, false)).toBe('hidden');
  });

  it('is visible only when ready and the Terminal tab is showing', () => {
    expect(xtermHostVisibility(true, true)).toBe('visible');
    expect(xtermHostVisibility(false, true)).toBe('hidden');
    expect(xtermHostVisibility(false, false)).toBe('hidden');
  });
});
