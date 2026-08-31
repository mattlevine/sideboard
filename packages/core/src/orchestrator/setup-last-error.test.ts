import { describe, expect, it } from 'vitest';
import {
  isStaleLastErrorDuringTurn,
  shouldStampSetupLastError,
} from './setup-last-error.js';

describe('shouldStampSetupLastError', () => {
  it('stamps when the thread is idle and no turn is in flight', () => {
    expect(shouldStampSetupLastError({ turnInFlight: false, status: 'idle' })).toBe(
      true,
    );
  });

  it('does not stamp over a live agent turn (Claude already in tool_use)', () => {
    expect(
      shouldStampSetupLastError({ turnInFlight: true, status: 'running' }),
    ).toBe(false);
    expect(shouldStampSetupLastError({ turnInFlight: true, status: 'idle' })).toBe(
      false,
    );
    expect(
      shouldStampSetupLastError({ turnInFlight: false, status: 'running' }),
    ).toBe(false);
  });
});

describe('isStaleLastErrorDuringTurn', () => {
  it('treats any lastError as stale while a turn is owned', () => {
    expect(isStaleLastErrorDuringTurn('Setup exited 1')).toBe(true);
    expect(isStaleLastErrorDuringTurn('Process died (reconciled on startup)')).toBe(
      true,
    );
    expect(isStaleLastErrorDuringTurn(null)).toBe(false);
    expect(isStaleLastErrorDuringTurn('  ')).toBe(false);
  });
});
