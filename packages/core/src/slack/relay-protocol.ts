import { randomBytes } from 'node:crypto';
import type { SlackInboundMessage } from './socket-mode.js';

/** Desktop → relay */
export type SlackRelayClientMessage =
  | {
      type: 'register';
      teamId: string;
      /** Slack user who owns this Sideboard (from OAuth authed_user). */
      userId: string;
      /** Stable per-Mac id so Personal and Work can both stay connected. */
      deviceId: string;
      /** Human label, e.g. "Personal" / "Work". */
      deviceLabel?: string;
      botToken: string;
      /** User token proves identity (auth.test user_id must match). */
      userToken: string;
    }
  | { type: 'claim'; eventId: string }
  | { type: 'ping' };

/** Relay → desktop */
export type SlackRelayServerMessage =
  | { type: 'registered'; teamId: string; userId: string; deviceId: string }
  | { type: 'event'; eventId: string; message: SlackInboundMessage }
  | { type: 'claim_ok'; eventId: string }
  | { type: 'claim_denied'; eventId: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export function slackRelaySessionKey(
  teamId: string,
  userId: string,
  deviceId: string,
): string {
  return `${teamId.trim()}:${userId.trim()}:${deviceId.trim()}`;
}

export function slackRelayUserKey(teamId: string, userId: string): string {
  return `${teamId.trim()}:${userId.trim()}`;
}

export function newSlackRelayEventId(): string {
  return randomBytes(12).toString('hex');
}

export function parseSlackRelayClientMessage(raw: string): SlackRelayClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as SlackRelayClientMessage;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;
    if (parsed.type === 'ping') return { type: 'ping' };
    if (parsed.type === 'claim') {
      const eventId = typeof parsed.eventId === 'string' ? parsed.eventId.trim() : '';
      if (!eventId) return null;
      return { type: 'claim', eventId };
    }
    if (parsed.type === 'register') {
      const teamId = typeof parsed.teamId === 'string' ? parsed.teamId.trim() : '';
      const userId = typeof parsed.userId === 'string' ? parsed.userId.trim() : '';
      const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId.trim() : '';
      const deviceLabel =
        typeof parsed.deviceLabel === 'string' ? parsed.deviceLabel.trim() : undefined;
      const botToken = typeof parsed.botToken === 'string' ? parsed.botToken.trim() : '';
      const userToken = typeof parsed.userToken === 'string' ? parsed.userToken.trim() : '';
      if (!teamId || !userId || !deviceId || !botToken || !userToken) return null;
      return {
        type: 'register',
        teamId,
        userId,
        deviceId,
        deviceLabel: deviceLabel || undefined,
        botToken,
        userToken,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseSlackRelayServerMessage(raw: string): SlackRelayServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as SlackRelayServerMessage;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;
    if (parsed.type === 'pong') return { type: 'pong' };
    if (parsed.type === 'registered') {
      const teamId = typeof parsed.teamId === 'string' ? parsed.teamId.trim() : '';
      const userId = typeof parsed.userId === 'string' ? parsed.userId.trim() : '';
      const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId.trim() : '';
      if (!teamId || !userId) return null;
      return { type: 'registered', teamId, userId, deviceId: deviceId || 'unknown' };
    }
    if (parsed.type === 'claim_ok' || parsed.type === 'claim_denied') {
      const eventId = typeof parsed.eventId === 'string' ? parsed.eventId.trim() : '';
      if (!eventId) return null;
      return { type: parsed.type, eventId };
    }
    if (parsed.type === 'error') {
      const message = typeof parsed.message === 'string' ? parsed.message : 'error';
      return { type: 'error', message };
    }
    if (parsed.type === 'event') {
      const eventId =
        typeof parsed.eventId === 'string' && parsed.eventId.trim()
          ? parsed.eventId.trim()
          : `legacy-${Date.now()}`;
      const msg = parsed.message;
      if (!msg || typeof msg !== 'object') return null;
      if (
        typeof msg.teamId !== 'string' ||
        typeof msg.channelId !== 'string' ||
        typeof msg.ts !== 'string' ||
        typeof msg.text !== 'string' ||
        (msg.kind !== 'dm' && msg.kind !== 'mention')
      ) {
        return null;
      }
      return { type: 'event', eventId, message: msg };
    }
    return null;
  } catch {
    return null;
  }
}
