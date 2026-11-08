import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSlackTokenKey } from '../slack/secret-box.js';
import { SlackAppStore } from './slack-apps.js';

describe('slack app store', () => {
  const key = parseSlackTokenKey(Buffer.alloc(32, 3).toString('base64'));
  const stores: SlackAppStore[] = [];
  let file = '';

  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
    file = '';
  });

  function open(): SlackAppStore {
    if (!file) file = join(mkdtempSync(join(tmpdir(), 'sb-slack-apps-')), 'accounts.sqlite');
    const store = new SlackAppStore(file, key);
    stores.push(store);
    return store;
  }

  it('keeps the bot token across a reopened file and not in plaintext', () => {
    const first = open();
    const created = first.create('acct-1');
    first.saveCredentials(created.registrationId, created.writeToken, {
      clientId: 'C1',
      clientSecret: 'client+secret',
      signingSecret: 'signing+secret',
    });
    expect(
      first.recordInstall({ clientId: 'C1', teamId: 'T1', botToken: 'xoxb+bot', botUserId: 'B1' }),
    ).toBe(true);
    first.close();
    stores.pop();

    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from('xoxb+bot'))).toBe(false);
    expect(raw.includes(Buffer.from('client+secret'))).toBe(false);
    expect(raw.includes(Buffer.from('signing+secret'))).toBe(false);

    const second = open();
    expect(second.listBots()).toEqual([{ teamId: 'T1', botToken: 'xoxb+bot' }]);
    expect(second.clientSecretFor('C1')).toBe('client+secret');
    expect(second.getByRegistration(created.registrationId)?.signingSecret).toBe('signing+secret');
  });

  it('rejects a bad write token and a different bot user', () => {
    const store = open();
    const created = store.create('acct-1');
    expect(() =>
      store.saveCredentials(created.registrationId, 'nope', {
        clientId: 'C1',
        clientSecret: 'secret',
        signingSecret: 'sign',
      }),
    ).toThrow(/write token/);
    store.saveCredentials(created.registrationId, created.writeToken, {
      clientId: 'C1',
      clientSecret: 'secret',
      signingSecret: 'sign',
    });
    store.recordInstall({ clientId: 'C1', teamId: 'T1', botToken: 'xoxb-bot', botUserId: 'B1' });
    expect(() =>
      store.recordInstall({ clientId: 'C1', teamId: 'T1', botToken: 'xoxb-other', botUserId: 'B2' }),
    ).toThrow(/bot user/);
    expect(store.botUserMismatch('T1', 'B2')).toMatch(/company/);
    expect(store.botUserMismatch('T1', 'B1')).toBeNull();
  });
});
