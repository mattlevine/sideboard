import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  LOCK_MS,
  looksSecret,
  oauthHeader,
  percentEncode,
  releaseOwnedLock,
  signatureBaseString,
  signHmacSha1,
  shipNoteText,
  tryAcquireLock,
  weightedLength,
} from './post.mjs';

function withLockDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'x-lock-'));
  const lockPath = join(dir, 'x-announce.lock');
  try {
    return fn(lockPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deadPid() {
  let pid = 1_000_000;
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return pid;
    }
    pid += 1000;
  }
  throw new Error('could not find an unused pid');
}

const CONSUMER_SECRET = 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw';
const TOKEN_SECRET = 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE';

test('percent-encodes the OAuth set', () => {
  assert.equal(percentEncode("Ladies + Gentlemen, a signed OAuth request!"), 'Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21');
  assert.equal(percentEncode('a*b'), 'a%2Ab');
});

test('matches the Twitter signature example', () => {
  const url = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true';
  const oauth = {
    oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
    oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: '1318622958',
    oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    oauth_version: '1.0',
  };
  const params = { ...oauth, status: 'Hello Ladies + Gentlemen, a signed OAuth request!' };
  const base = signatureBaseString('POST', url, params);
  assert.equal(
    base,
    'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521',
  );
  assert.equal(signHmacSha1(base, CONSUMER_SECRET, TOKEN_SECRET), 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
  const header = oauthHeader({
    method: 'GET',
    url: 'https://api.x.com/2/users/me',
    consumerKey: oauth.oauth_consumer_key,
    consumerSecret: CONSUMER_SECRET,
    token: oauth.oauth_token,
    tokenSecret: TOKEN_SECRET,
    nonce: oauth.oauth_nonce,
    timestamp: oauth.oauth_timestamp,
  });
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"/);
});

test('counts a URL as 23 characters', () => {
  const text = `Sideboard now keeps the board on this Mac.\nhttps://github.com/mattlevine/sideboard/pull/12`;
  assert.equal(weightedLength(text), 'Sideboard now keeps the board on this Mac.\n'.length + 23);
  assert.ok(weightedLength(text) <= 280);
});

test('sends the note as written and does not add a link', () => {
  const note = 'Sideboard now keeps the board on this Mac.';
  assert.equal(shipNoteText(note), note);
  const withLink = `${note}\nhttps://github.com/mattlevine/sideboard/pull/12`;
  assert.equal(shipNoteText(withLink), withLink);
  assert.equal(shipNoteText('  Sideboard now opens the board on this Mac.  '), 'Sideboard now opens the board on this Mac.');
});

test('secret check ignores sk- inside a word', () => {
  assert.equal(looksSecret('Sideboard now handles an ask-user prompt.'), false);
  assert.equal(looksSecret('mask-based redaction stays on this Mac.'), false);
  assert.equal(looksSecret('sk-proj-abc123'), true);
  assert.equal(looksSecret('The log contained sk-proj-abc123.'), true);
  assert.equal(looksSecret('token ghp_abcdefghijklmnopqrstuvwxyz123456'), true);
});

test('only one acquire holds the lock', () => {
  withLockDir((lockPath) => {
    const first = tryAcquireLock(lockPath);
    const second = tryAcquireLock(lockPath);
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(readFileSync(lockPath, 'utf8'), first);
    releaseOwnedLock(lockPath, first);
    const third = tryAcquireLock(lockPath);
    assert.ok(third);
    assert.notEqual(third, first);
  });
});

test('release does not delete a lock this process no longer owns', () => {
  withLockDir((lockPath) => {
    const first = tryAcquireLock(lockPath);
    assert.ok(first);
    const replacement = `${process.pid} ${Date.now()} replacement\n`;
    writeFileSync(lockPath, replacement);
    releaseOwnedLock(lockPath, first);
    assert.equal(readFileSync(lockPath, 'utf8'), replacement);
  });
});

test('a dead or expired owner can be replaced', () => {
  withLockDir((lockPath) => {
    writeFileSync(lockPath, `${deadPid()} ${Date.now()} dead\n`);
    const taken = tryAcquireLock(lockPath);
    assert.ok(taken);
    assert.equal(readFileSync(lockPath, 'utf8'), taken);
    releaseOwnedLock(lockPath, taken);

    writeFileSync(lockPath, `${process.pid} ${Date.now() - LOCK_MS - 1} expired\n`);
    const expired = tryAcquireLock(lockPath);
    assert.ok(expired);
    assert.equal(readFileSync(lockPath, 'utf8'), expired);
  });
});

test('a live owner is left alone', () => {
  withLockDir((lockPath) => {
    const existing = `${process.pid} ${Date.now()} held\n`;
    writeFileSync(lockPath, existing);
    assert.equal(tryAcquireLock(lockPath), null);
    assert.equal(readFileSync(lockPath, 'utf8'), existing);
  });
});
