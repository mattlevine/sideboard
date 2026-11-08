import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openSecret, sealSecret } from '../slack/secret-box.js';

/**
 * One internal Slack app per company. Client secret, signing secret, and bot
 * token are AES-GCM ciphertext. The write token is stored only as a hash.
 * User tokens are never written here.
 */
export class SlackAppStore {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(filePath: string, key: Buffer) {
    if (key.length !== 32) throw new Error('Slack token key must be 32 bytes');
    mkdirSync(dirname(filePath), { recursive: true });
    this.key = key;
    this.db = openDatabase(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slack_apps (
        registration_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        write_token_hash TEXT NOT NULL,
        team_id TEXT,
        client_id TEXT,
        client_secret_enc TEXT,
        signing_secret_enc TEXT,
        bot_token_enc TEXT,
        bot_user_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS slack_apps_client
        ON slack_apps(client_id) WHERE client_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS slack_apps_team
        ON slack_apps(team_id) WHERE team_id IS NOT NULL;
    `);
  }

  close(): void {
    this.db.close();
  }

  /** Mint a row. The write token is returned once and authorizes credential upload. */
  create(accountId: string): { registrationId: string; writeToken: string } {
    const owner = accountId.trim();
    if (!owner) throw new Error('Slack app registration needs a Sideboard account');
    const registrationId = randomBytes(16).toString('base64url');
    const writeToken = randomBytes(32).toString('base64url');
    this.db
      .prepare(
        `INSERT INTO slack_apps (
          registration_id, account_id, write_token_hash, created_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(registrationId, owner, sha256(writeToken), Date.now());
    return { registrationId, writeToken };
  }

  saveCredentials(
    registrationId: string,
    writeToken: string,
    creds: { clientId: string; clientSecret: string; signingSecret: string },
  ): void {
    const row = this.row(registrationId);
    if (!row || !sameHash(row.write_token_hash, sha256(writeToken.trim()))) {
      throw new Error('Slack app write token was rejected');
    }
    const clientId = creds.clientId.trim();
    const clientSecret = creds.clientSecret.trim();
    const signingSecret = creds.signingSecret.trim();
    if (!clientId || !clientSecret || !signingSecret) {
      throw new Error('Slack app credentials need a client id, client secret, and signing secret');
    }
    const taken = this.db
      .prepare(
        'SELECT registration_id FROM slack_apps WHERE client_id = ? AND registration_id != ?',
      )
      .get(clientId, row.registration_id) as { registration_id: string } | undefined;
    if (taken) throw new Error('That Slack client id is already registered');
    this.db
      .prepare(
        `UPDATE slack_apps
         SET client_id = ?, client_secret_enc = ?, signing_secret_enc = ?
         WHERE registration_id = ?`,
      )
      .run(clientId, sealSecret(this.key, clientSecret), sealSecret(this.key, signingSecret), row.registration_id);
  }

  clientSecretFor(clientId: string): string | null {
    const id = clientId.trim();
    if (!id) return null;
    const row = this.db
      .prepare('SELECT client_secret_enc FROM slack_apps WHERE client_id = ?')
      .get(id) as { client_secret_enc: string | null } | undefined;
    if (!row?.client_secret_enc) return null;
    return openSecret(this.key, row.client_secret_enc);
  }

  /**
   * OAuth finished for this client id. Rejects a different bot user than the
   * one already stored for the company.
   */
  recordInstall(input: {
    clientId: string;
    teamId: string;
    botToken: string;
    botUserId: string;
  }): boolean {
    const clientId = input.clientId.trim();
    const teamId = input.teamId.trim();
    const botToken = input.botToken.trim();
    const botUserId = input.botUserId.trim();
    if (!clientId || !teamId || !botToken) return false;
    const row = this.db
      .prepare('SELECT registration_id, team_id, bot_user_id FROM slack_apps WHERE client_id = ?')
      .get(clientId) as { registration_id: string; team_id: string | null; bot_user_id: string | null } | undefined;
    if (!row) return false;
    if (row.team_id && row.team_id !== teamId) {
      throw new Error('This Slack app is already installed on another workspace');
    }
    if (botUserId && row.bot_user_id && row.bot_user_id !== botUserId) {
      throw new Error('This Slack app’s bot user does not match the stored install');
    }
    this.db
      .prepare(
        `UPDATE slack_apps
         SET team_id = ?, bot_token_enc = ?, bot_user_id = COALESCE(?, bot_user_id)
         WHERE registration_id = ?`,
      )
      .run(teamId, sealSecret(this.key, botToken), botUserId || null, row.registration_id);
    return true;
  }

  /** Error string when a desktop presents a different bot than the company app. */
  botUserMismatch(teamId: string, botUserId: string): string | null {
    const row = this.teamRow(teamId);
    if (!row?.bot_user_id) return null;
    if (row.bot_user_id === botUserId.trim()) return null;
    return 'This Mac’s bot token is not the company’s Sideboard Slack app';
  }

  /** Refresh the stored bot token after a desktop register for this team. */
  saveBot(teamId: string, botToken: string, botUserId: string): void {
    const row = this.teamRow(teamId);
    const token = botToken.trim();
    const user = botUserId.trim();
    if (!row || !token || !user) return;
    if (row.bot_user_id && row.bot_user_id !== user) return;
    this.db
      .prepare('UPDATE slack_apps SET bot_token_enc = ?, bot_user_id = ? WHERE registration_id = ?')
      .run(sealSecret(this.key, token), user, row.registration_id);
  }

  getByRegistration(registrationId: string): {
    registrationId: string;
    teamId: string | null;
    signingSecret: string | null;
  } | null {
    const row = this.row(registrationId);
    if (!row) return null;
    return {
      registrationId: row.registration_id,
      teamId: row.team_id,
      signingSecret: row.signing_secret_enc ? openSecret(this.key, row.signing_secret_enc) : null,
    };
  }

  listBots(): Array<{ teamId: string; botToken: string }> {
    const rows = this.db
      .prepare(
        `SELECT team_id, bot_token_enc FROM slack_apps
         WHERE team_id IS NOT NULL AND bot_token_enc IS NOT NULL`,
      )
      .all() as Array<{ team_id: string; bot_token_enc: string }>;
    return rows.map((row) => ({
      teamId: row.team_id,
      botToken: openSecret(this.key, row.bot_token_enc),
    }));
  }

  deleteByTeam(teamId: string): void {
    const id = teamId.trim();
    if (!id) return;
    this.db.prepare('DELETE FROM slack_apps WHERE team_id = ?').run(id);
  }

  private row(registrationId: string): SlackAppRow | null {
    const id = registrationId.trim();
    if (!id) return null;
    return (
      (this.db.prepare('SELECT * FROM slack_apps WHERE registration_id = ?').get(id) as
        | SlackAppRow
        | undefined) ?? null
    );
  }

  private teamRow(teamId: string): SlackAppRow | null {
    const id = teamId.trim();
    if (!id) return null;
    return (
      (this.db.prepare('SELECT * FROM slack_apps WHERE team_id = ?').get(id) as SlackAppRow | undefined) ??
      null
    );
  }
}

type SlackAppRow = {
  registration_id: string;
  account_id: string;
  write_token_hash: string;
  team_id: string | null;
  client_id: string | null;
  client_secret_enc: string | null;
  signing_secret_enc: string | null;
  bot_token_enc: string | null;
  bot_user_id: string | null;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(stored: string, presented: string): boolean {
  const left = Buffer.from(stored);
  const right = Buffer.from(presented);
  return left.length === right.length && timingSafeEqual(left, right);
}

function thisModuleFile(): string {
  // eslint-disable-next-line camelcase
  const cjsFile = typeof __filename !== 'undefined' ? __filename : '';
  return cjsFile || process.argv[1] || join(process.cwd(), 'package.json');
}

function openDatabase(filePath: string): DatabaseSync {
  const req = createRequire(thisModuleFile());
  const { DatabaseSync: SqliteDatabase } = req('node:sqlite') as typeof import('node:sqlite');
  const db = new SqliteDatabase(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}
