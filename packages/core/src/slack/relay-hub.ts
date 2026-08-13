import { slackApi, type SlackAuthTest } from './api.js';
import type { SlackInboundMessage } from './socket-mode.js';
import {
  newSlackRelayEventId,
  slackRelaySessionKey,
  slackRelayUserKey,
  type SlackRelayClientMessage,
  type SlackRelayServerMessage,
} from './relay-protocol.js';

export interface SlackRelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SlackRelaySession {
  id: string;
  teamId: string;
  userId: string;
  deviceId: string;
  deviceLabel: string;
  socket: SlackRelaySocket;
  connectedAt: number;
}

export interface SlackRelayHubOptions {
  fetchImpl?: typeof fetch;
  /** Inject auth.test for tests. */
  authTest?: (token: string) => Promise<Pick<SlackAuthTest, 'team_id' | 'user_id' | 'ok'>>;
  onLog?: (line: string) => void;
}

type PendingClaim = {
  winnerKey: string | null;
  /** session keys that were offered this event */
  offered: Set<string>;
};

/** `Personal: …` / `@Work: …` / `to work: …` → route to that Mac. */
export function parseSlackDeviceDestination(text: string): {
  label: string | null;
  rest: string;
} {
  const m = text.match(/^\s*(?:to\s+)?(?:@|#)?([A-Za-z][\w-]{0,63})\s*[:：]\s*/);
  if (!m) return { label: null, rest: text };
  return { label: m[1]!, rest: text.slice(m[0].length) };
}

/**
 * In-memory registry of desktop sessions keyed by team + Slack user + device.
 * Personal and Work Macs can both stay online. Inbound events fan out to the
 * matching destination(s); the first device to claim handles the turn.
 */
export class SlackRelayHub {
  private readonly sessions = new Map<string, SlackRelaySession>();
  private readonly bySocket = new Map<SlackRelaySocket, string>();
  private readonly pendingClaims = new Map<string, PendingClaim>();
  private seq = 0;
  private readonly fetchImpl?: typeof fetch;
  private readonly authTest: (
    token: string,
  ) => Promise<Pick<SlackAuthTest, 'team_id' | 'user_id' | 'ok'>>;
  private readonly log: (line: string) => void;

  constructor(opts: SlackRelayHubOptions = {}) {
    this.fetchImpl = opts.fetchImpl;
    this.log = opts.onLog ?? (() => undefined);
    this.authTest =
      opts.authTest ??
      (async (token) =>
        slackApi<SlackAuthTest>(token, 'auth.test', undefined, this.fetchImpl));
  }

  sessionFor(teamId: string, userId: string, deviceId: string): SlackRelaySession | null {
    return this.sessions.get(slackRelaySessionKey(teamId, userId, deviceId)) ?? null;
  }

  sessionsForUser(teamId: string, userId: string): SlackRelaySession[] {
    const t = teamId.trim();
    const u = userId.trim();
    return [...this.sessions.values()].filter((s) => s.teamId === t && s.userId === u);
  }

  listSessions(): SlackRelaySession[] {
    return [...this.sessions.values()];
  }

  detachSocket(socket: SlackRelaySocket): void {
    const key = this.bySocket.get(socket);
    this.bySocket.delete(socket);
    if (!key) return;
    const current = this.sessions.get(key);
    if (current?.socket === socket) {
      this.sessions.delete(key);
      this.log(`desktop disconnected ${key}`);
    }
  }

  async handleClientMessage(
    socket: SlackRelaySocket,
    msg: SlackRelayClientMessage,
  ): Promise<void> {
    if (msg.type === 'ping') {
      this.send(socket, { type: 'pong' });
      return;
    }
    if (msg.type === 'claim') {
      this.handleClaim(socket, msg.eventId);
      return;
    }
    if (msg.type === 'register') {
      await this.register(
        socket,
        msg.teamId,
        msg.userId,
        msg.deviceId,
        msg.deviceLabel,
        msg.botToken,
        msg.userToken,
      );
    }
  }

  async register(
    socket: SlackRelaySocket,
    teamId: string,
    userId: string,
    deviceId: string,
    deviceLabel: string | undefined,
    botToken: string,
    userToken: string,
  ): Promise<void> {
    const claimedTeam = teamId.trim();
    const claimedUser = userId.trim();
    const claimedDevice = deviceId.trim();
    const label = (deviceLabel?.trim() || claimedDevice).slice(0, 64);
    const bot = botToken.trim();
    const user = userToken.trim();
    if (!claimedTeam || !claimedUser || !claimedDevice || !bot || !user) {
      this.send(socket, {
        type: 'error',
        message: 'register needs teamId, userId, deviceId, botToken, and userToken',
      });
      return;
    }

    try {
      const userAuth = await this.authTest(user);
      const userTeam = userAuth.team_id?.trim();
      const userAuthId = userAuth.user_id?.trim();
      if (!userTeam || !userAuthId) {
        this.send(socket, {
          type: 'error',
          message: 'user token auth.test did not return team_id/user_id',
        });
        return;
      }
      if (userTeam !== claimedTeam || userAuthId !== claimedUser) {
        this.send(socket, {
          type: 'error',
          message: `User token identity ${userTeam}/${userAuthId} does not match claimed ${claimedTeam}/${claimedUser}`,
        });
        this.log(
          `register rejected: claimed ${claimedTeam}/${claimedUser} user-token ${userTeam}/${userAuthId}`,
        );
        return;
      }

      const botAuth = await this.authTest(bot);
      const botTeam = botAuth.team_id?.trim();
      if (!botTeam) {
        this.send(socket, {
          type: 'error',
          message: 'bot token auth.test did not return team_id',
        });
        return;
      }
      if (botTeam !== claimedTeam) {
        this.send(socket, {
          type: 'error',
          message: `Bot token team_id ${botTeam} does not match claimed ${claimedTeam}`,
        });
        this.log(`register rejected: claimed team ${claimedTeam} bot ${botTeam}`);
        return;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.send(socket, { type: 'error', message: `auth.test failed: ${errMsg}` });
      return;
    }

    const key = slackRelaySessionKey(claimedTeam, claimedUser, claimedDevice);
    const prev = this.sessions.get(key);
    if (prev && prev.socket !== socket) {
      try {
        prev.socket.close(4000, 'replaced');
      } catch {
        // ignore
      }
      this.bySocket.delete(prev.socket);
    }

    const session: SlackRelaySession = {
      id: `s${++this.seq}`,
      teamId: claimedTeam,
      userId: claimedUser,
      deviceId: claimedDevice,
      deviceLabel: label,
      socket,
      connectedAt: Date.now(),
    };
    this.sessions.set(key, session);
    this.bySocket.set(socket, key);
    this.send(socket, {
      type: 'registered',
      teamId: claimedTeam,
      userId: claimedUser,
      deviceId: claimedDevice,
    });
    this.log(`desktop registered ${key} (${label})`);
  }

  /**
   * Fan-out an inbound event to matching device(s) for that Slack user.
   * Optional leading `Personal:` / `Work:` selects by device label.
   * Desktops must claim; first claim wins.
   */
  routeEvent(message: SlackInboundMessage): boolean {
    const userId = message.userId?.trim();
    if (!userId) {
      this.log(`skip event ${message.ts}: missing user id`);
      return false;
    }
    const online = this.sessionsForUser(message.teamId, userId);
    if (online.length === 0) {
      this.log(`no desktop for ${slackRelayUserKey(message.teamId, userId)} — skip`);
      return false;
    }

    const { label, rest } = parseSlackDeviceDestination(message.text);
    let targets = online;
    let outbound = message;
    if (label) {
      const needle = label.toLowerCase();
      targets = online.filter((s) => s.deviceLabel.toLowerCase() === needle);
      if (targets.length === 0) {
        this.log(
          `no device labeled "${label}" for ${slackRelayUserKey(message.teamId, userId)} — skip (online: ${online.map((s) => s.deviceLabel).join(', ')})`,
        );
        return false;
      }
      outbound = { ...message, text: rest };
    }

    const eventId = newSlackRelayEventId();
    this.pendingClaims.set(eventId, {
      winnerKey: null,
      offered: new Set(
        targets.map((s) => slackRelaySessionKey(s.teamId, s.userId, s.deviceId)),
      ),
    });
    // Expire stale claims after 60s.
    setTimeout(() => this.pendingClaims.delete(eventId), 60_000).unref?.();

    for (const session of targets) {
      this.send(session.socket, { type: 'event', eventId, message: outbound });
    }
    this.log(
      `fan-out ${eventId} → ${targets.map((s) => s.deviceLabel || s.deviceId).join(', ')}${label ? ` (dest ${label})` : ''}`,
    );
    return true;
  }

  private handleClaim(socket: SlackRelaySocket, eventId: string): void {
    const key = this.bySocket.get(socket);
    if (!key) {
      this.send(socket, { type: 'error', message: 'claim before register' });
      return;
    }
    const pending = this.pendingClaims.get(eventId);
    if (!pending || !pending.offered.has(key)) {
      this.send(socket, { type: 'claim_denied', eventId });
      return;
    }
    if (!pending.winnerKey) {
      pending.winnerKey = key;
      this.send(socket, { type: 'claim_ok', eventId });
      this.log(`claim_ok ${eventId} → ${key}`);
      return;
    }
    this.send(socket, { type: 'claim_denied', eventId });
  }

  private send(socket: SlackRelaySocket, msg: SlackRelayServerMessage): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`send error: ${errMsg}`);
    }
  }
}
