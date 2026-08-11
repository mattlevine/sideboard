import { describe, expect, it } from 'vitest';

/** Mirror of cursor-runner busy detection (kept in sync for unit coverage). */
function isAgentBusyMessage(message: string): boolean {
  return /already has active run/i.test(message);
}

describe('Cursor agent busy recovery', () => {
  it('detects the SDK active-run conflict message', () => {
    expect(
      isAgentBusyMessage(
        'Agent agent-e721fcef-4894-423c-ac9d-58382e7d9835 already has active run',
      ),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isAgentBusyMessage('Agent agent-1 not found')).toBe(false);
    expect(isAgentBusyMessage('invalid API key')).toBe(false);
  });
});
