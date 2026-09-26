import { describe, expect, it } from 'vitest';
import {
  MCP_WAIT_FOR_TURN_MAX_MS,
  MCP_WAIT_BROKEN_HINT,
  MCP_WAIT_ERROR_HINT,
  MCP_WAIT_INPUT_REQUIRED_HINT,
  MCP_WAIT_QUEUED_HINT,
  MCP_WAIT_STILL_RUNNING_HINT,
  MCP_WAIT_STOPPED_HINT,
  mcpWaitFinishedHint,
  mcpWaitForTurnTimeoutMs,
  mcpWaitStillRunningHint,
  mcpWaitTaskHint,
} from './wait-for-turn.js';

describe('mcpWaitForTurnTimeoutMs', () => {
  it('caps above the MCP client kill window', () => {
    expect(mcpWaitForTurnTimeoutMs(90_000)).toBe(MCP_WAIT_FOR_TURN_MAX_MS);
    expect(mcpWaitForTurnTimeoutMs(600_000)).toBe(MCP_WAIT_FOR_TURN_MAX_MS);
  });

  it('honors short requested waits', () => {
    expect(mcpWaitForTurnTimeoutMs(5_000)).toBe(5_000);
  });

  it('defaults to the cap', () => {
    expect(mcpWaitForTurnTimeoutMs()).toBe(MCP_WAIT_FOR_TURN_MAX_MS);
  });
});

describe('mcpWaitStillRunningHint', () => {
  it('tells coordinators a queued child has not started', () => {
    expect(mcpWaitStillRunningHint('queued')).toBe(MCP_WAIT_QUEUED_HINT);
    expect(mcpWaitStillRunningHint('running')).toBe(MCP_WAIT_STILL_RUNNING_HINT);
  });
});

describe('mcpWaitFinishedHint', () => {
  it('flags stopped and error as incomplete', () => {
    expect(mcpWaitFinishedHint('stopped')).toBe(MCP_WAIT_STOPPED_HINT);
    expect(mcpWaitFinishedHint('error')).toBe(MCP_WAIT_ERROR_HINT);
    expect(mcpWaitFinishedHint('idle')).toBeUndefined();
  });
});

describe('mcpWaitTaskHint', () => {
  it('maps A2A taskState to coordinator hints', () => {
    expect(mcpWaitTaskHint('submitted')).toBe(MCP_WAIT_QUEUED_HINT);
    expect(mcpWaitTaskHint('working')).toBe(MCP_WAIT_STILL_RUNNING_HINT);
    expect(mcpWaitTaskHint('input-required')).toBe(MCP_WAIT_INPUT_REQUIRED_HINT);
    expect(mcpWaitTaskHint('canceled')).toBe(MCP_WAIT_STOPPED_HINT);
    expect(mcpWaitTaskHint('failed')).toBe(MCP_WAIT_ERROR_HINT);
    expect(mcpWaitTaskHint('failed', 'broken')).toBe(MCP_WAIT_BROKEN_HINT);
    expect(mcpWaitTaskHint('completed')).toBeUndefined();
  });
});
