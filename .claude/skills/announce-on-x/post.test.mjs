import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthHeader, percentEncode, signatureBaseString, signHmacSha1, weightedLength } from './post.mjs';

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
