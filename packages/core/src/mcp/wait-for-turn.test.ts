import { describe, expect, it } from 'vitest';
import {
  MCP_WAIT_FOR_TURN_MAX_MS,
  mcpWaitForTurnTimeoutMs,
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
