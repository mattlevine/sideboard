import { createHash, randomBytes } from 'node:crypto';

/**
 * Proof that this Mac finished Slack OAuth as a specific user.
 * Not a Slack API token. The shared bot token cannot stand in for it.
 */
export interface SlackListenGrants {
  /** Plaintext is returned once. Null when team or user is blank. */
  issue(teamId: string, userId: string): string | null;
  verify(teamId: string, userId: string, grant: string): boolean;
  revokeTeam(teamId: string): void;
  close(): void;
}

/** In-process grants for a relay with no account database. Lost on restart. */
export class MemorySlackListenGrants implements SlackListenGrants {
  private readonly rows = new Map<string, { teamId: string; userId: string }>();

  issue(teamId: string, userId: string): string | null {
    const team = teamId.trim();
    const user = userId.trim();
    if (!team || !user) return null;
    const grant = randomBytes(32).toString('base64url');
    this.rows.set(hashListenGrant(grant), { teamId: team, userId: user });
    return grant;
  }

  verify(teamId: string, userId: string, grant: string): boolean {
    const token = grant.trim();
    if (!token) return false;
    const row = this.rows.get(hashListenGrant(token));
    if (!row) return false;
    return row.teamId === teamId.trim() && row.userId === userId.trim();
  }

  revokeTeam(teamId: string): void {
    const team = teamId.trim();
    if (!team) return;
    for (const [hash, row] of this.rows) {
      if (row.teamId === team) this.rows.delete(hash);
    }
  }

  close(): void {
    this.rows.clear();
  }
}

export function hashListenGrant(grant: string): string {
  return createHash('sha256').update(grant.trim()).digest('hex');
}
