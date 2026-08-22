import { describe, expect, it } from 'vitest';
import { splitTurnQueue } from './visible-follow-up-queue';

describe('splitTurnQueue', () => {
  it('treats a lone queued prompt as the current turn while idle', () => {
    expect(splitTurnQueue(['hello'], 'queued', false)).toEqual({
      currentTurnPrompt: 'hello',
      followUps: [],
    });
  });

  it('keeps extra items as follow-ups behind the current turn', () => {
    expect(splitTurnQueue(['now', 'later'], 'queued', false)).toEqual({
      currentTurnPrompt: 'now',
      followUps: ['later'],
    });
  });

  it('shows the full queue while a turn is in flight', () => {
    expect(splitTurnQueue(['follow-up'], 'running', true)).toEqual({
      currentTurnPrompt: null,
      followUps: ['follow-up'],
    });
  });

  it('shows parked items after stop (not draining as the current turn)', () => {
    expect(splitTurnQueue(['parked'], 'stopped', false)).toEqual({
      currentTurnPrompt: null,
      followUps: ['parked'],
    });
    expect(splitTurnQueue(['parked'], 'idle', false)).toEqual({
      currentTurnPrompt: null,
      followUps: ['parked'],
    });
  });
});
