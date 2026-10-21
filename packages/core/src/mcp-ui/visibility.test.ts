import { describe, expect, it } from 'vitest';
import { toolVisibleTo, visibilityFromMeta } from './visibility.js';

describe('visibilityFromMeta', () => {
  it('defaults to model and app', () => {
    expect(visibilityFromMeta(undefined)).toEqual(['model', 'app']);
    expect(visibilityFromMeta({ ui: { resourceUri: 'ui://x' } })).toEqual(['model', 'app']);
  });

  it('reads app-only tools', () => {
    expect(visibilityFromMeta({ ui: { visibility: ['app'] } })).toEqual(['app']);
    expect(toolVisibleTo(['app'], 'model')).toBe(false);
    expect(toolVisibleTo(['app'], 'app')).toBe(true);
  });
});
