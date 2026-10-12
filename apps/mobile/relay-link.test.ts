import { describe, expect, it } from 'vitest';
import { nextRelayPhase } from './relay-link';

describe('nextRelayPhase', () => {
  it('retries a live drop before telling the user', () => {
    expect(nextRelayPhase('up', true)).toEqual({ phase: 'retrying', reportError: false, retry: true });
  });

  it('reports the relay only after that retry fails', () => {
    expect(nextRelayPhase('retrying', true)).toEqual({ phase: 'down', reportError: true, retry: true });
  });

  it('keeps retrying quietly once the failure is already shown', () => {
    expect(nextRelayPhase('down', true)).toEqual({ phase: 'down', reportError: false, retry: true });
  });

  it('reports immediately when there is nothing to retry', () => {
    expect(nextRelayPhase('up', false)).toEqual({ phase: 'down', reportError: true, retry: false });
  });
});
