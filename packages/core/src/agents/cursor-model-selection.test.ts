import { describe, expect, it } from 'vitest';
import { buildCursorModelSelection } from './cursor-model-selection.js';

describe('buildCursorModelSelection', () => {
  it('maps auto/default/empty to default id', () => {
    expect(buildCursorModelSelection(null, { fast: false }).id).toBe('default');
    expect(buildCursorModelSelection('', { fast: false }).id).toBe('default');
    expect(buildCursorModelSelection('Auto', { fast: false }).id).toBe('default');
    expect(buildCursorModelSelection('default', { fast: false }).id).toBe('default');
  });

  it('preserves concrete model ids', () => {
    expect(buildCursorModelSelection('grok-4.6', { fast: false }).id).toBe('grok-4.6');
  });

  it('always sends explicit fast=false when Fast is off', () => {
    expect(buildCursorModelSelection('grok-4.6', { effort: 'high', fast: false })).toEqual({
      id: 'grok-4.6',
      params: [
        { id: 'effort', value: 'high' },
        { id: 'fast', value: 'false' },
      ],
    });
  });

  it('sends explicit fast=true when Fast is on', () => {
    expect(buildCursorModelSelection('grok-4.6', { fast: true })).toEqual({
      id: 'grok-4.6',
      params: [{ id: 'fast', value: 'true' }],
    });
  });

  it('normalizes legacy effort "normal" to medium', () => {
    const sel = buildCursorModelSelection('composer-2.5', {
      effort: 'normal',
      fast: false,
    });
    expect(sel.params).toEqual([
      { id: 'effort', value: 'medium' },
      { id: 'fast', value: 'false' },
    ]);
  });

  it('omits invalid effort but still sends fast', () => {
    expect(buildCursorModelSelection('default', { effort: 'bogus', fast: false })).toEqual({
      id: 'default',
      params: [{ id: 'fast', value: 'false' }],
    });
  });
});
