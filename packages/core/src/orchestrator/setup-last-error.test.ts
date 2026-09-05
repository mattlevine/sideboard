import { describe, expect, it } from 'vitest';
import {
  isSetupLastError,
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

  it('does not stamp while the first prompt is queued for a concurrency slot', () => {
    expect(
      shouldStampSetupLastError({ turnInFlight: false, status: 'queued' }),
    ).toBe(false);
    expect(
      shouldStampSetupLastError({
        turnInFlight: false,
        status: 'idle',
        hasQueuedPrompt: true,
      }),
    ).toBe(false);
  });
});

describe('isSetupLastError', () => {
  it('matches auto-setup chrome only', () => {
    expect(isSetupLastError('Setup exited 1')).toBe(true);
    expect(isSetupLastError('Setup failed: pnpm install')).toBe(true);
    expect(isSetupLastError('First prompt failed: timeout')).toBe(false);
    expect(isSetupLastError('exit 1')).toBe(false);
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
