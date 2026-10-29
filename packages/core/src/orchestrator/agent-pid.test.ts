import { describe, expect, it } from 'vitest';
import { isSameAgentProcess, pidStartedAt } from './agent-pid.js';

describe('isSameAgentProcess', () => {
  it('matches the recorded start time and refuses a different stamp', () => {
    const stamp = pidStartedAt(process.pid);
    if (!stamp) return;
    expect(isSameAgentProcess(process.pid, stamp, true)).toBe(true);
    expect(isSameAgentProcess(process.pid, 'not-the-start', true)).toBe(false);
    expect(isSameAgentProcess(process.pid, stamp, false)).toBe(false);
  });
});
