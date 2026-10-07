import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** Google’s OpenID issuer. The subject is Google’s `sub`, not the email. */
export const GOOGLE_ACCOUNT_ISSUER = 'https://accounts.google.com';
/** GitHub’s issuer. The subject is the numeric user id, not the login. */
export const GITHUB_ACCOUNT_ISSUER = 'https://github.com';

/** Macs one Sideboard account may register on the relay. */
export const RELAY_DEVICE_CAP = 3;

export type RelaySignInIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

export type RelaySignInResult = {
  accountId: string;
  credential: string;
  email: string | null;
};

export type RelayHostAuthorization =
  | { ok: true; accountId: string }
  | { ok: false; message: string };

type IdentityRow = {
  issuer: string;
  subject: string;
  account_id: string;
  email: string | null;
  email_verified: number;
};

type AccountRow = { id: string; device_cap: number };
type DeviceRow = { device_id: string; account_id: string; host_secret_hash: string };

/**
 * Filename for `createRequire`. Do not use `import.meta.url` — tsup CJS leaves
 * it empty. A direct `import from 'node:sqlite'` is rewritten to `require("sqlite")`,
 * which crashes the desktop on load. Electron never opens this store.
 */
function thisModuleFile(): string {
  // eslint-disable-next-line camelcase
  const cjsFile = typeof __filename !== 'undefined' ? __filename : '';
  return cjsFile || process.argv[1] || join(process.cwd(), 'package.json');
}

function openDatabase(filePath: string): DatabaseSync {
  const req = createRequire(thisModuleFile());
  const specifier = 'node:sqlite';
  const { DatabaseSync: SqliteDatabase } = req(specifier) as typeof import('node:sqlite');
  const db = new SqliteDatabase(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase() ?? '';
  return trimmed || null;
}

/**
 * Longest mount point that contains `dir`. `/data` on a Fly volume is durable.
 * A directory on the root filesystem is wiped by the next image deploy.
 */
export function longestMountPoint(dir: string, mounts: string): string {
  let best = '/';
  for (const line of mounts.split('\n')) {
    const point = line.split(' ')[1]?.replace(/\\040/g, ' ');
    if (!point) continue;
    if (dir === point || dir.startsWith(point.endsWith('/') ? point : `${point}/`)) {
      if (point.length > best.length) best = point;
    }
  }
  return best;
}

/**
 * Production accounts must sit on a volume, not the container root filesystem.
 * Non-Linux (desktop tests) skips the check. Set `SIDEBOARD_RELAY_ACCOUNTS_EPHEMERAL=1`
 * only for a local production-mode process.
 */
export function assertRelayAccountsDurable(filePath: string): void {
  if (process.env.SIDEBOARD_RELAY_ACCOUNTS_EPHEMERAL === '1') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (process.platform !== 'linux') return;
  const dir = realpathSync(dirname(filePath));
  const mounts = readFileSync('/proc/mounts', 'utf8');
  const point = longestMountPoint(dir, mounts);
  if (point === '/') {
    throw new Error(
      `Relay accounts at ${filePath} are on the machine root filesystem. Mount a Fly volume so sign-ins survive deploys.`,
    );
  }
}

/**
 * Sideboard accounts on the relay. The file is the source of truth across
 * process restarts. On Fly it lives on a volume so image deploys keep it.
 * Prompts are not stored here.
 */
export class RelayAccountStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = openDatabase(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        device_cap INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identities (
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        account_id TEXT NOT NULL,
        email TEXT,
        email_verified INTEGER NOT NULL,
        PRIMARY KEY (issuer, subject)
      );
      CREATE INDEX IF NOT EXISTS identities_email ON identities(email);
      CREATE TABLE IF NOT EXISTS credentials (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        host_secret_hash TEXT NOT NULL,
        device_label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * First sign-in creates an account. The same issuer+subject returns that
   * account. A verified email match attaches a second provider. `linkAccountId`
   * attaches while that account’s credential is already signed in.
   * Each call mints a new Mac credential. Older credentials stay valid.
   */
  signIn(identity: RelaySignInIdentity, linkAccountId?: string | null): RelaySignInResult {
    const issuer = identity.issuer.trim();
    const subject = identity.subject.trim();
    if (!issuer || !subject) throw new Error('Sign-in is missing an identity.');
    const email = normalizeEmail(identity.email);
    const verified = Boolean(identity.emailVerified && email);
    const link = linkAccountId?.trim() || null;

    this.db.exec('BEGIN');
    try {
      const existing = this.db
        .prepare('SELECT account_id, email FROM identities WHERE issuer = ? AND subject = ?')
        .get(issuer, subject) as Pick<IdentityRow, 'account_id' | 'email'> | undefined;
      let accountId: string;
      if (existing) {
        if (link && link !== existing.account_id) {
          throw new Error('That sign-in already belongs to another Sideboard account.');
        }
        accountId = existing.account_id;
        this.requireAccount(accountId);
        if (email) {
          this.db
            .prepare('UPDATE identities SET email = ?, email_verified = ? WHERE issuer = ? AND subject = ?')
            .run(email, verified ? 1 : 0, issuer, subject);
        }
      } else if (link) {
        this.requireAccount(link);
        accountId = link;
        this.insertIdentity(issuer, subject, accountId, email, verified);
      } else {
        const byEmail = verified ? this.accountIdForVerifiedEmail(email!) : undefined;
        accountId = byEmail ?? randomUUID();
        if (!byEmail) {
          this.db
            .prepare('INSERT INTO accounts (id, created_at, device_cap) VALUES (?, ?, ?)')
            .run(accountId, Date.now(), RELAY_DEVICE_CAP);
        }
        this.insertIdentity(issuer, subject, accountId, email, verified);
      }
      const credential = this.mintCredential(accountId);
      const stored = this.db
        .prepare('SELECT email FROM identities WHERE account_id = ? AND email IS NOT NULL ORDER BY email_verified DESC LIMIT 1')
        .get(accountId) as { email: string | null } | undefined;
      this.db.exec('COMMIT');
      return { accountId, credential, email: stored?.email ?? email };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  verifyCredential(token: string): string | null {
    const trimmed = token.trim();
    if (!trimmed) return null;
    const row = this.db
      .prepare('SELECT account_id FROM credentials WHERE token_hash = ?')
      .get(sha256(trimmed)) as { account_id: string } | undefined;
    return row?.account_id ?? null;
  }

  /** Drop one Mac credential. The account and its other Macs stay. */
  logout(token: string): void {
    const trimmed = token.trim();
    if (!trimmed) return;
    this.db.prepare('DELETE FROM credentials WHERE token_hash = ?').run(sha256(trimmed));
  }

  /** Delete the account and every identity, credential, and Mac bound to it. */
  revokeAccount(accountId: string): void {
    const id = accountId.trim();
    if (!id) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM devices WHERE account_id = ?').run(id);
      this.db.prepare('DELETE FROM credentials WHERE account_id = ?').run(id);
      this.db.prepare('DELETE FROM identities WHERE account_id = ?').run(id);
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Accept `host_register` for a signed-in account. The device row survives
   * process restart, so a later register with a different host secret is rejected
   * and a new device id counts against the cap.
   */
  authorizeHost(input: {
    accountToken: string;
    deviceId: string;
    deviceLabel: string;
    hostSecret: string;
  }): RelayHostAuthorization {
    const deviceId = input.deviceId.trim();
    const hostSecret = input.hostSecret.trim();
    const deviceLabel = input.deviceLabel.trim() || 'This Mac';
    if (!deviceId || !hostSecret) return { ok: false, message: 'sign in required' };
    const accountId = this.verifyCredential(input.accountToken);
    if (!accountId) return { ok: false, message: 'sign in required' };

    this.db.exec('BEGIN');
    try {
      const account = this.db.prepare('SELECT id, device_cap FROM accounts WHERE id = ?').get(accountId) as
        | AccountRow
        | undefined;
      if (!account) {
        this.db.exec('ROLLBACK');
        return { ok: false, message: 'sign in required' };
      }
      const device = this.db
        .prepare('SELECT device_id, account_id, host_secret_hash FROM devices WHERE device_id = ?')
        .get(deviceId) as DeviceRow | undefined;
      const secretHash = sha256(hostSecret);
      if (!device) {
        const count = this.db
          .prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ?')
          .get(accountId) as { n: number };
        if (count.n >= account.device_cap) {
          this.db.exec('ROLLBACK');
          return { ok: false, message: 'This account already has the maximum number of Macs.' };
        }
        this.db
          .prepare(
            'INSERT INTO devices (device_id, account_id, host_secret_hash, device_label, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(deviceId, accountId, secretHash, deviceLabel, Date.now());
        this.db.exec('COMMIT');
        return { ok: true, accountId };
      }
      if (device.account_id !== accountId) {
        this.db.exec('ROLLBACK');
        return { ok: false, message: 'This Mac is registered to another account.' };
      }
      if (!sameHash(device.host_secret_hash, secretHash)) {
        this.db.exec('ROLLBACK');
        return { ok: false, message: 'host secret rejected' };
      }
      this.db.prepare('UPDATE devices SET device_label = ? WHERE device_id = ?').run(deviceLabel, deviceId);
      this.db.exec('COMMIT');
      return { ok: true, accountId };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private requireAccount(accountId: string): void {
    const row = this.db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!row) throw new Error('That Sideboard account is no longer on the relay.');
  }

  private accountIdForVerifiedEmail(email: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT account_id FROM identities WHERE email_verified = 1 AND email = ? LIMIT 1',
      )
      .get(email) as { account_id: string } | undefined;
    return row?.account_id;
  }

  private insertIdentity(
    issuer: string,
    subject: string,
    accountId: string,
    email: string | null,
    verified: boolean,
  ): void {
    this.db
      .prepare(
        'INSERT INTO identities (issuer, subject, account_id, email, email_verified) VALUES (?, ?, ?, ?, ?)',
      )
      .run(issuer, subject, accountId, email, verified ? 1 : 0);
  }

  private mintCredential(accountId: string): string {
    const credential = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO credentials (token_hash, account_id, created_at) VALUES (?, ?, ?)')
      .run(sha256(credential), accountId, Date.now());
    return credential;
  }
}
