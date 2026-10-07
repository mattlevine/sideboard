import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_ACCOUNT_ISSUER,
  GOOGLE_ACCOUNT_ISSUER,
  longestMountPoint,
  RelayAccountStore,
} from './accounts.js';

describe('relay accounts', () => {
  const stores: RelayAccountStore[] = [];
  let file = '';

  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
    file = '';
  });

  function open(): RelayAccountStore {
    if (!file) file = join(mkdtempSync(join(tmpdir(), 'sb-relay-accounts-')), 'accounts.sqlite');
    const store = new RelayAccountStore(file);
    stores.push(store);
    return store;
  }

  it('keeps the account, credential, and Mac secret across a reopened file', () => {
    const first = open();
    const signed = first.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: 'Ada@Example.com',
      emailVerified: true,
    });
    expect(signed.email).toBe('ada@example.com');
    expect(
      first.authorizeHost({
        accountToken: signed.credential,
        deviceId: 'mac-1',
        deviceLabel: 'Work',
        hostSecret: 'host-secret',
      }),
    ).toEqual({ ok: true, accountId: signed.accountId });
    first.close();
    stores.pop();

    const second = open();
    expect(
      second.authorizeHost({
        accountToken: signed.credential,
        deviceId: 'mac-1',
        deviceLabel: 'Work',
        hostSecret: 'host-secret',
      }).ok,
    ).toBe(true);
    expect(
      second.authorizeHost({
        accountToken: signed.credential,
        deviceId: 'mac-1',
        deviceLabel: 'Work',
        hostSecret: 'other-secret',
      }),
    ).toEqual({ ok: false, message: 'host secret rejected' });
    expect(second.authorizeHost({
      accountToken: 'nope',
      deviceId: 'mac-2',
      deviceLabel: 'Work',
      hostSecret: 'host-secret',
    })).toEqual({ ok: false, message: 'sign in required' });
  });

  it('links GitHub onto the Google account when the verified email matches', () => {
    const store = open();
    const google = store.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: 'ada@example.com',
      emailVerified: true,
    });
    const github = store.signIn({
      issuer: GITHUB_ACCOUNT_ISSUER,
      subject: '99',
      email: 'Ada@Example.com',
      emailVerified: true,
    });
    expect(github.accountId).toBe(google.accountId);
    expect(store.verifyCredential(google.credential)).toBe(google.accountId);
    expect(store.verifyCredential(github.credential)).toBe(google.accountId);
  });

  it('does not link an unverified email, and links when already signed in', () => {
    const store = open();
    const google = store.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: 'ada@example.com',
      emailVerified: true,
    });
    const unverified = store.signIn({
      issuer: GITHUB_ACCOUNT_ISSUER,
      subject: '99',
      email: 'ada@example.com',
      emailVerified: false,
    });
    expect(unverified.accountId).not.toBe(google.accountId);
    const linked = store.signIn(
      {
        issuer: GITHUB_ACCOUNT_ISSUER,
        subject: '100',
        email: 'other@example.com',
        emailVerified: true,
      },
      google.accountId,
    );
    expect(linked.accountId).toBe(google.accountId);
    expect(() =>
      store.signIn(
        {
          issuer: GOOGLE_ACCOUNT_ISSUER,
          subject: 'google-sub-1',
          email: 'ada@example.com',
          emailVerified: true,
        },
        unverified.accountId,
      ),
    ).toThrow(/another Sideboard account/);
  });

  it('caps Macs at three and keeps a device on its first account', () => {
    const store = open();
    const signed = store.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: null,
      emailVerified: false,
    });
    for (const id of ['mac-1', 'mac-2', 'mac-3']) {
      expect(
        store.authorizeHost({
          accountToken: signed.credential,
          deviceId: id,
          deviceLabel: id,
          hostSecret: `secret-${id}`,
        }).ok,
      ).toBe(true);
    }
    expect(
      store.authorizeHost({
        accountToken: signed.credential,
        deviceId: 'mac-4',
        deviceLabel: 'mac-4',
        hostSecret: 'secret-mac-4',
      }),
    ).toEqual({ ok: false, message: 'This account already has the maximum number of Macs.' });

    const other = store.signIn({
      issuer: GITHUB_ACCOUNT_ISSUER,
      subject: '7',
      email: null,
      emailVerified: false,
    });
    expect(
      store.authorizeHost({
        accountToken: other.credential,
        deviceId: 'mac-1',
        deviceLabel: 'Stolen',
        hostSecret: 'secret-mac-1',
      }),
    ).toEqual({ ok: false, message: 'This Mac is registered to another account.' });
  });

  it('logout drops one credential and revoke drops the account', () => {
    const store = open();
    const signed = store.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: 'ada@example.com',
      emailVerified: true,
    });
    const second = store.signIn({
      issuer: GOOGLE_ACCOUNT_ISSUER,
      subject: 'google-sub-1',
      email: 'ada@example.com',
      emailVerified: true,
    });
    store.logout(signed.credential);
    expect(store.verifyCredential(signed.credential)).toBeNull();
    expect(store.verifyCredential(second.credential)).toBe(second.accountId);
    store.revokeAccount(second.accountId);
    expect(store.verifyCredential(second.credential)).toBeNull();
  });
});

describe('longestMountPoint', () => {
  it('treats a Fly volume at /data as durable and the root filesystem as not', () => {
    const mounts = ['overlay / overlay rw 0 0', 'ext4 /data ext4 rw 0 0'].join('\n');
    expect(longestMountPoint('/data', mounts)).toBe('/data');
    expect(longestMountPoint('/', mounts)).toBe('/');
    expect(longestMountPoint('/app', mounts)).toBe('/');
  });
});
