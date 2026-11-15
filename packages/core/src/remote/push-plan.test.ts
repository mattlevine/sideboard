import { describe, expect, it } from 'vitest';
import { parsePushData, sessionTokensForPush } from '../../../../apps/mobile/push-plan.ts';

describe('phone push plan', () => {
  it('registers every Mac except one with alerts off', () => {
    expect(
      sessionTokensForPush([
        { sessionToken: 'work', notify: true },
        { sessionToken: 'home' },
        { sessionToken: 'quiet', notify: false },
      ]),
    ).toEqual(['work', 'home']);
  });

  it('reads only the ids from a notification', () => {
    expect(parsePushData({ deviceId: 'mac-1', chatId: 'chat-1234', body: 'secret' })).toEqual({
      deviceId: 'mac-1',
      chatId: 'chat-1234',
    });
    expect(parsePushData(null)).toBeNull();
  });
});
