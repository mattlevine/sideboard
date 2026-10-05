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

  it('pins Grok 4.7 local runs to 256k context and catalog reasoning_effort', () => {
    expect(buildCursorModelSelection('grok-4.7', { effort: 'high', fast: false })).toEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '256k' },
        { id: 'reasoning_effort', value: 'high' },
        { id: 'fast', value: 'false' },
      ],
    });
  });

  it('maps Grok 4.7 Sideboard max effort to catalog xhigh', () => {
    expect(buildCursorModelSelection('grok-4.7', { effort: 'max', fast: false }).params).toEqual([
      { id: 'context', value: '256k' },
      { id: 'reasoning_effort', value: 'xhigh' },
      { id: 'fast', value: 'false' },
    ]);
  });

  it('does not pin context on Grok 4.6', () => {
    expect(buildCursorModelSelection('grok-4.6', { fast: false }).params).toEqual([
      { id: 'fast', value: 'false' },
    ]);
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
