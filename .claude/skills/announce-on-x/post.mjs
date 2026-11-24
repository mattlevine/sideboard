#!/usr/bin/env node
/**
 * Post one ship note to @sideboard_build, or record a skip.
 * Reads X_API_KEY, X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 * from the environment. Never prints those values.
 *
 *   node .claude/skills/announce-on-x/post.mjs status
 *   node .claude/skills/announce-on-x/post.mjs init
 *   node .claude/skills/announce-on-x/post.mjs skip --pr 123 --reason "ci only"
 *   node .claude/skills/announce-on-x/post.mjs post --pr 123 --text "..." [--image file.png]
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEDGER_PATH = join(homedir(), '.sideboard', 'x-announced.json');
const LOCK_PATH = join(homedir(), '.sideboard', 'x-announce.lock');
const DEFAULT_REPO = 'mattlevine/sideboard';
const EXPECTED_USERNAME = 'sideboard_build';
const LOCK_MS = 2 * 60 * 1000;
const URL_WEIGHT = 23;

export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** OAuth 1.0a signature base string. JSON bodies are not included. */
export function signatureBaseString(method, url, params) {
  const parsed = new URL(url);
  const baseUrl = `${parsed.origin}${parsed.pathname}`;
  const all = { ...params };
  for (const [key, value] of parsed.searchParams) all[key] = value;
  const paramString = Object.keys(all)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(all[key])}`)
    .join('&');
  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join('&');
}

export function signHmacSha1(baseString, consumerSecret, tokenSecret) {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(baseString).digest('base64');
}

export function oauthHeader({
  method,
  url,
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  nonce = randomBytes(16).toString('hex'),
  timestamp = Math.floor(Date.now() / 1000).toString(),
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: '1.0',
  };
  const base = signatureBaseString(method, url, oauth);
  const signature = signHmacSha1(base, consumerSecret, tokenSecret);
  const signed = { ...oauth, oauth_signature: signature };
  const header = Object.keys(signed)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(signed[key])}"`)
    .join(', ');
  return `OAuth ${header}`;
}

/** X counts each URL as 23 characters. */
export function weightedLength(text) {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(URL_WEIGHT)).length;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function credentials() {
  const consumerKey = process.env.X_API_KEY ?? '';
  const consumerSecret = process.env.X_API_KEY_SECRET ?? '';
  const token = process.env.X_ACCESS_TOKEN ?? '';
  const tokenSecret = process.env.X_ACCESS_TOKEN_SECRET ?? '';
  const missing = [
    ['X_API_KEY', consumerKey],
    ['X_API_KEY_SECRET', consumerSecret],
    ['X_ACCESS_TOKEN', token],
    ['X_ACCESS_TOKEN_SECRET', tokenSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')} in the environment. They are account Settings → Environment keys.`);
  }
  return { consumerKey, consumerSecret, token, tokenSecret };
}

function readLedger() {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return { repo: DEFAULT_REPO, account: EXPECTED_USERNAME, since: null, prs: {} };
  }
}

function writeLedger(ledger) {
  mkdirSync(join(homedir(), '.sideboard'), { recursive: true });
  const tmp = `${LEDGER_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmp, LEDGER_PATH);
}

function withLock(fn) {
  mkdirSync(join(homedir(), '.sideboard'), { recursive: true });
  try {
    const raw = readFileSync(LOCK_PATH, 'utf8');
    const age = Date.now() - Number(raw);
    if (Number.isFinite(age) && age >= 0 && age < LOCK_MS) {
      console.error('Another announce is in progress.');
      process.exitCode = 3;
      return Promise.resolve();
    }
  } catch {
    // no lock
  }
  writeFileSync(LOCK_PATH, String(Date.now()));
  return Promise.resolve(fn()).finally(() => {
    try {
      writeFileSync(LOCK_PATH, '0');
    } catch {
      // ignore
    }
  });
}

async function xFetch(url, { method = 'GET', body, headers } = {}) {
  const { consumerKey, consumerSecret, token, tokenSecret } = credentials();
  const authorization = oauthHeader({
    method,
    url,
    consumerKey,
    consumerSecret,
    token,
    tokenSecret,
  });
  const response = await fetch(url, {
    method,
    headers: { Authorization: authorization, ...headers },
    body,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = (text || response.statusText).slice(0, 500);
    throw new Error(`X ${method} ${new URL(url).pathname} failed (${response.status}): ${detail}`);
  }
  return json;
}

async function whoami() {
  const me = await xFetch('https://api.x.com/2/users/me');
  const username = me?.data?.username ?? '';
  const id = me?.data?.id ?? '';
  if (username !== EXPECTED_USERNAME) {
    throw new Error(`Refusing to post. The token is @${username || 'unknown'}, not @${EXPECTED_USERNAME}.`);
  }
  return { id, username };
}

function prUrl(repo, pr) {
  return `https://github.com/${repo}/pull/${pr}`;
}

function looksSecret(text) {
  return /gh[pousr]_|github_pat_|AKIA|xox[baprs]-|sk-|BEGIN [A-Z ]*PRIVATE KEY/i.test(text);
}

async function alreadyOnTimeline(userId, url) {
  const timeline = await xFetch(
    `https://api.x.com/2/users/${userId}/tweets?max_results=100&tweet.fields=text,entities`,
  );
  for (const tweet of timeline?.data ?? []) {
    const expanded = (tweet.entities?.urls ?? []).map((item) => item.expanded_url ?? '').join(' ');
    if ((tweet.text ?? '').includes(url) || expanded.includes(url)) {
      return { tweetId: tweet.id, url: `https://x.com/${EXPECTED_USERNAME}/status/${tweet.id}` };
    }
  }
  return null;
}

function remember(pr, entry) {
  const ledger = readLedger();
  ledger.repo = DEFAULT_REPO;
  ledger.account = EXPECTED_USERNAME;
  ledger.prs ??= {};
  ledger.prs[String(pr)] = { ...entry, at: new Date().toISOString() };
  writeLedger(ledger);
  return ledger;
}

async function post() {
  const pr = arg('--pr');
  const text = arg('--text');
  const image = arg('--image');
  const repo = arg('--repo') || DEFAULT_REPO;
  if (!pr || !/^\d+$/.test(pr)) throw new Error('post requires --pr <number>');
  if (!text?.trim()) throw new Error('post requires --text');
  if (repo !== DEFAULT_REPO) throw new Error(`Refusing to announce ${repo}. This account is for ${DEFAULT_REPO}.`);
  if (looksSecret(text)) throw new Error('Refusing to post. The text looks like it contains a token.');

  const link = prUrl(repo, pr);
  const full = text.includes(link) ? text.trim() : `${text.trim()}\n${link}`;
  const length = weightedLength(full);
  if (length > 280) throw new Error(`Post is ${length} characters with the link counted as 23. Keep it at or under 280.`);

  const ledger = readLedger();
  const prior = ledger.prs?.[pr];
  if (prior?.action === 'posted') {
    console.log(JSON.stringify({ ok: true, already: true, pr: Number(pr), ...prior }));
    return;
  }

  const me = await whoami();
  const existing = await alreadyOnTimeline(me.id, link);
  if (existing) {
    remember(pr, { action: 'posted', tweetId: existing.tweetId, url: existing.url });
    console.log(JSON.stringify({ ok: true, already: true, pr: Number(pr), ...existing }));
    return;
  }

  let mediaId = null;
  if (image) {
    const bytes = readFileSync(image);
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Image is over 5MB.');
    const type = /\.jpe?g$/i.test(image) ? 'image/jpeg' : /\.webp$/i.test(image) ? 'image/webp' : 'image/png';
    const form = new FormData();
    form.append('media', new Blob([bytes], { type }), 'image');
    const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
    const uploaded = await xFetch(uploadUrl, { method: 'POST', body: form });
    mediaId = uploaded?.media_id_string ?? (uploaded?.media_id != null ? String(uploaded.media_id) : null);
    if (!mediaId) throw new Error('X accepted the image upload but returned no media id.');
  }

  const payload = mediaId ? { text: full, media: { media_ids: [mediaId] } } : { text: full };
  const created = await xFetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const tweetId = created?.data?.id;
  if (!tweetId) throw new Error('X accepted the post but returned no tweet id.');
  const url = `https://x.com/${EXPECTED_USERNAME}/status/${tweetId}`;
  remember(pr, { action: 'posted', tweetId, url });
  console.log(JSON.stringify({ ok: true, pr: Number(pr), tweetId, url, text: full }));
}

function skip() {
  const pr = arg('--pr');
  const reason = arg('--reason');
  if (!pr || !/^\d+$/.test(pr)) throw new Error('skip requires --pr <number>');
  if (!reason?.trim()) throw new Error('skip requires --reason');
  const ledger = readLedger();
  if (ledger.prs?.[pr]?.action === 'posted') {
    console.log(JSON.stringify({ ok: true, pr: Number(pr), kept: 'posted' }));
    return;
  }
  remember(pr, { action: 'skipped', reason: reason.trim() });
  console.log(JSON.stringify({ ok: true, pr: Number(pr), action: 'skipped', reason: reason.trim() }));
}

function init() {
  const ledger = readLedger();
  if (!ledger.since) ledger.since = new Date().toISOString();
  ledger.repo = DEFAULT_REPO;
  ledger.account = EXPECTED_USERNAME;
  ledger.prs ??= {};
  writeLedger(ledger);
  console.log(JSON.stringify({ ok: true, since: ledger.since, recorded: Object.keys(ledger.prs).length }));
}

function status() {
  const ledger = readLedger();
  console.log(JSON.stringify({ ok: true, path: LEDGER_PATH, ...ledger }));
}

async function printWhoami() {
  const me = await whoami();
  console.log(JSON.stringify({ ok: true, ...me }));
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const command = process.argv[2];
  const run =
    command === 'status'
      ? status
      : command === 'whoami'
        ? printWhoami
        : command === 'init'
        ? init
        : command === 'skip'
          ? skip
          : command === 'post'
            ? () => withLock(post)
            : null;
  if (!run) {
    console.error('Usage: post.mjs status|whoami|init|skip|post');
    process.exitCode = 1;
  } else {
    Promise.resolve(run()).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
