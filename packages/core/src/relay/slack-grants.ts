import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { hashListenGrant, type SlackListenGrants } from '../slack/listen-grant.js';

/**
 * Listen grants in the relay account database. Only the hash is stored.
 * User tokens are not written here.
 */
export class SlackListenGrantStore implements SlackListenGrants {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = openDatabase(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slack_listen_grants (
        grant_hash TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS slack_listen_grants_team
        ON slack_listen_grants(team_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  issue(teamId: string, userId: string): string | null {
    const team = teamId.trim();
    const user = userId.trim();
    if (!team || !user) return null;
    const grant = randomBytes(32).toString('base64url');
    this.db
      .prepare(
        `INSERT INTO slack_listen_grants (grant_hash, team_id, user_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hashListenGrant(grant), team, user, Date.now());
    return grant;
  }

  verify(teamId: string, userId: string, grant: string): boolean {
    const token = grant.trim();
    const team = teamId.trim();
    const user = userId.trim();
    if (!token || !team || !user) return false;
    const row = this.db
      .prepare('SELECT team_id, user_id FROM slack_listen_grants WHERE grant_hash = ?')
      .get(hashListenGrant(token)) as { team_id: string; user_id: string } | undefined;
    return row?.team_id === team && row.user_id === user;
  }

  revokeTeam(teamId: string): void {
    const team = teamId.trim();
    if (!team) return;
    this.db.prepare('DELETE FROM slack_listen_grants WHERE team_id = ?').run(team);
  }
}

function thisModuleFile(): string {
  // eslint-disable-next-line camelcase
  const cjsFile = typeof __filename !== 'undefined' ? __filename : '';
  return cjsFile || process.argv[1] || join(process.cwd(), 'package.json');
}

function openDatabase(filePath: string): DatabaseSync {
  // Do not `import from 'node:sqlite'` — tsup rewrites that to `require("sqlite")`.
  const req = createRequire(thisModuleFile());
  const { DatabaseSync: SqliteDatabase } = req('node:sqlite') as typeof import('node:sqlite');
  const db = new SqliteDatabase(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}
