import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SlackListenGrantStore } from './slack-grants.js';

describe('slack listen grants', () => {
  const stores: SlackListenGrantStore[] = [];
  let file = '';

  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
    file = '';
  });

  function open(): SlackListenGrantStore {
    if (!file) file = join(mkdtempSync(join(tmpdir(), 'sb-slack-grants-')), 'accounts.sqlite');
    const store = new SlackListenGrantStore(file);
    stores.push(store);
    return store;
  }

  it('keeps a grant across a reopened file and not in plaintext', () => {
    const first = open();
    const grant = first.issue('T1', 'U1');
    expect(grant).toBeTruthy();
    expect(first.verify('T1', 'U1', grant!)).toBe(true);
    expect(first.verify('T1', 'U2', grant!)).toBe(false);
    expect(first.verify('T1', 'U1', 'nope')).toBe(false);
    first.close();
    stores.pop();

    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from(grant!))).toBe(false);

    const second = open();
    expect(second.verify('T1', 'U1', grant!)).toBe(true);
    second.revokeTeam('T1');
    expect(second.verify('T1', 'U1', grant!)).toBe(false);
  });
});
