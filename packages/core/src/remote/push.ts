import type { OrchestratorEvent } from '../types/thread.js';
import { BAKED_REMOTE_RELAY_URL } from './protocol.js';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushKind = 'needs_you' | 'finished' | 'failed';

const EXPO_TOKEN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]{8,140}\]$/;

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN.test(value);
}

/** Push is sent only by Sideboard's relay. A LAN or custom relay has no push key. */
export function hostedPushRelay(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(BAKED_REMOTE_RELAY_URL).hostname;
  } catch {
    return false;
  }
}

export function pushBody(kind: PushKind): string {
  if (kind === 'needs_you') return 'A chat needs you';
  if (kind === 'failed') return 'A chat failed';
  return 'A turn finished';
}

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: { deviceId: string; chatId: string; kind: PushKind };
  sound: 'default';
  priority: 'high';
};

/** Alert text is a fixed sentence plus the Mac's name. No chat message is included. */
export function expoPushMessage(input: {
  to: string;
  deviceLabel: string;
  deviceId: string;
  chatId: string;
  kind: PushKind;
}): ExpoPushMessage {
  return {
    to: input.to,
    title: input.deviceLabel,
    body: pushBody(input.kind),
    data: { deviceId: input.deviceId, chatId: input.chatId, kind: input.kind },
    sound: 'default',
    priority: 'high',
  };
}

/**
 * New "needs you" chats, plus a finished or failed turn that is not itself
 * a new needs-you (that alert is the one that matters).
 */
export function pushNotes(input: {
  event: OrchestratorEvent | null;
  before: ReadonlySet<string>;
  after: ReadonlySet<string>;
}): Array<{ chatId: string; kind: PushKind }> {
  const notes: Array<{ chatId: string; kind: PushKind }> = [];
  const fresh = new Set<string>();
  for (const id of input.after) {
    if (input.before.has(id)) continue;
    fresh.add(id);
    notes.push({ chatId: id, kind: 'needs_you' });
  }
  const event = input.event;
  if (!event || (event.type !== 'turn_finished' && event.type !== 'error')) return notes;
  if (fresh.has(event.threadId)) return notes;
  const finished = event.type === 'turn_finished' && (event.exitCode === 0 || event.exitCode == null);
  notes.push({ chatId: event.threadId, kind: finished ? 'finished' : 'failed' });
  return notes;
}

export interface PushTokenStore {
  replace(token: string, deviceIds: string[]): void;
  tokens(deviceId: string): string[];
}

export class MemoryPushTokens implements PushTokenStore {
  private readonly rows = new Map<string, Set<string>>();

  replace(token: string, deviceIds: string[]): void {
    const ids = new Set(deviceIds.filter(Boolean));
    if (ids.size === 0) this.rows.delete(token);
    else this.rows.set(token, ids);
  }

  tokens(deviceId: string): string[] {
    const out: string[] = [];
    for (const [token, ids] of this.rows) {
      if (ids.has(deviceId)) out.push(token);
    }
    return out;
  }
}

export async function sendExpoPushes(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (messages.length === 0) return;
  const res = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { data?: Array<{ status?: string; message?: string }> } | null;
  const failed = body?.data?.find((row) => row.status === 'error');
  if (failed) throw new Error(failed.message || 'Expo push rejected');
}
