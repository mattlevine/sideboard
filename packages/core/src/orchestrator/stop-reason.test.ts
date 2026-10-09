import { describe, expect, it } from 'vitest';
import { reasonToKeepOnStop, resolveStopReason } from './stop-reason.js';

describe('stop reasons', () => {
  it('names the stop kind when nobody passed a note', () => {
    expect(resolveStopReason()).toBe('Stopped (queue cleared)');
    expect(resolveStopReason({ clearQueue: false })).toBe('Stopped by the user');
    expect(resolveStopReason({ clearQueue: false, continueQueue: true })).toBe(
      'Stopped to send the next prompt',
    );
  });

  it('keeps an explicit note and does not let a later write erase it', () => {
    expect(resolveStopReason({ reason: '  context limit  ' })).toBe('context limit');
    expect(reasonToKeepOnStop('context limit')).toBe('context limit');
    expect(reasonToKeepOnStop('context limit', '  ')).toBe('context limit');
    expect(reasonToKeepOnStop(null, 'Stopped by the user')).toBe('Stopped by the user');
    expect(reasonToKeepOnStop(null)).toBe('Stopped');
  });
});
