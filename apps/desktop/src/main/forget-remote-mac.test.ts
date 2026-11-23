import { describe, expect, it } from 'vitest';
import { runForgetRemoteMac } from './forget-remote-mac';

describe('runForgetRemoteMac', () => {
  it('stops this Mac before forget and signs out without restarting first', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = runForgetRemoteMac({
      self: true,
      stopHost: () => order.push('stop'),
      startHost: () => order.push('start'),
      forget: () => {
        order.push('forget');
        return gate;
      },
      signOut: async () => {
        order.push('signOut');
        return 'signed-out';
      },
      settings: () => 'settings',
    });
    expect(order).toEqual(['stop', 'forget']);
    release();
    await expect(pending).resolves.toBe('signed-out');
    expect(order).toEqual(['stop', 'forget', 'signOut']);
  });

  it('restarts this Mac when forget fails, and does not sign out', async () => {
    const order: string[] = [];
    await expect(
      runForgetRemoteMac({
        self: true,
        stopHost: () => order.push('stop'),
        startHost: () => order.push('start'),
        forget: async () => {
          order.push('forget');
          throw new Error('relay down');
        },
        signOut: async () => {
          order.push('signOut');
          return 'signed-out';
        },
        settings: () => 'settings',
      }),
    ).rejects.toThrow('relay down');
    expect(order).toEqual(['stop', 'forget', 'start']);
  });

  it('forgets another Mac without touching this connection', async () => {
    const order: string[] = [];
    await expect(
      runForgetRemoteMac({
        self: false,
        stopHost: () => order.push('stop'),
        startHost: () => order.push('start'),
        forget: async () => {
          order.push('forget');
        },
        signOut: async () => {
          order.push('signOut');
          return 'signed-out';
        },
        settings: () => 'settings',
      }),
    ).resolves.toBe('settings');
    expect(order).toEqual(['forget']);
  });
});
