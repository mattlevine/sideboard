import { describe, expect, it } from 'vitest';
import { hostKeepsMacAwake } from './awake.js';

const idle = {
  phoneConnected: false,
  phoneRemoteArmed: false,
  caffeinateWhilePhoneRemote: false,
  agentsRunning: 0,
  caffeinateWhileRunning: false,
  schedulesEnabled: false,
  caffeinateWhileSchedules: false,
};

describe('hostKeepsMacAwake', () => {
  it('stays asleep when nothing is holding the Mac', () => {
    expect(hostKeepsMacAwake(idle)).toBe(false);
    expect(hostKeepsMacAwake({ ...idle, phoneRemoteArmed: true })).toBe(false);
    expect(hostKeepsMacAwake({ ...idle, caffeinateWhilePhoneRemote: true })).toBe(false);
  });

  it('holds while a phone is connected even when the setting is off', () => {
    expect(hostKeepsMacAwake({ ...idle, phoneConnected: true })).toBe(true);
  });

  it('holds while the remote is armed only when that setting is on', () => {
    expect(
      hostKeepsMacAwake({
        ...idle,
        phoneRemoteArmed: true,
        caffeinateWhilePhoneRemote: true,
      }),
    ).toBe(true);
  });

  it('still honors the agent and automation toggles', () => {
    expect(
      hostKeepsMacAwake({ ...idle, agentsRunning: 1, caffeinateWhileRunning: true }),
    ).toBe(true);
    expect(hostKeepsMacAwake({ ...idle, agentsRunning: 1 })).toBe(false);
    expect(
      hostKeepsMacAwake({
        ...idle,
        schedulesEnabled: true,
        caffeinateWhileSchedules: true,
      }),
    ).toBe(true);
  });
});
