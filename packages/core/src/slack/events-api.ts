import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  inboundFromSocketFrame,
  lifecycleFromSocketFrame,
  type SlackInboundMessage,
  type SlackLifecycleEvent,
  type SlackSocketEvent,
  type SlackSocketFrame,
} from './socket-mode.js';

const MAX_SKEW_MS = 5 * 60_000;

/** Slack signs `v0:timestamp:rawBody` with the app signing secret. */
export function verifySlackRequestSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}): boolean {
  const timestamp = opts.timestamp.trim();
  const signature = opts.signature.trim();
  const seconds = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(seconds)) return false;
  const now = opts.nowMs ?? Date.now();
  if (Math.abs(now - seconds * 1000) > MAX_SKEW_MS) return false;
  const hmac = createHmac('sha256', opts.signingSecret)
    .update(`v0:${timestamp}:${opts.rawBody}`)
    .digest('hex');
  const expected = Buffer.from(`v0=${hmac}`);
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

export interface SlackEventsApiBody {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: SlackSocketEvent;
}

export function parseSlackEventsBody(raw: string): SlackEventsApiBody | null {
  try {
    const parsed = JSON.parse(raw) as SlackEventsApiBody;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function asSocketFrame(body: SlackEventsApiBody): SlackSocketFrame {
  return {
    type: 'events_api',
    payload: {
      team_id: typeof body.team_id === 'string' ? body.team_id : undefined,
      event: body.event,
    },
  };
}

export function inboundFromEventsBody(body: SlackEventsApiBody): SlackInboundMessage | null {
  if (body.type !== 'event_callback') return null;
  return inboundFromSocketFrame(asSocketFrame(body));
}

export function lifecycleFromEventsBody(body: SlackEventsApiBody): SlackLifecycleEvent | null {
  if (body.type !== 'event_callback') return null;
  return lifecycleFromSocketFrame(asSocketFrame(body));
}

/** Drop Slack retries of the same event_id. Memory only; one relay machine. */
export class SlackEventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60_000) {}

  duplicate(eventId: string, now = Date.now()): boolean {
    const id = eventId.trim();
    if (!id) return false;
    for (const [key, expires] of this.seen) {
      if (expires <= now) this.seen.delete(key);
    }
    if (this.seen.has(id)) return true;
    this.seen.set(id, now + this.ttlMs);
    return false;
  }
}
