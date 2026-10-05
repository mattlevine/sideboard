/** Phone ↔ relay ↔ Mac. Message text only. The Mac runs the orchestrator. */

export const REMOTE_RELAY_PATH = '/remote';

export const BAKED_REMOTE_RELAY_URL = `wss://relay.sideboard.cloud${REMOTE_RELAY_PATH}`;

export function remoteRelayUrl(): string {
  return process.env.SIDEBOARD_REMOTE_RELAY_URL?.trim() || BAKED_REMOTE_RELAY_URL;
}

export interface RemoteAskOption {
  label: string;
  description?: string;
}

export interface RemoteAskQuestion {
  question: string;
  options: RemoteAskOption[];
}

/** Mac → relay */
export type RemoteHostMessage =
  | {
      type: 'host_register';
      deviceId: string;
      deviceLabel: string;
      hostSecret: string;
    }
  | { type: 'host_pair' }
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: RemoteAskQuestion[] }
  | { type: 'ping' };

export interface RemoteHostSummary {
  sessionToken: string;
  deviceId: string;
  deviceLabel: string;
  online: boolean;
}

/** Phone → relay */
export type RemotePhoneMessage =
  | { type: 'pair'; code: string }
  | { type: 'resume'; sessionToken: string }
  | { type: 'list_hosts'; sessionTokens: string[] }
  | { type: 'prompt'; text: string }
  | { type: 'stop' }
  | { type: 'ping' };

export type RemoteClientMessage = RemoteHostMessage | RemotePhoneMessage;

/** Relay → Mac or phone */
export type RemoteServerMessage =
  | { type: 'registered'; deviceId: string; deviceLabel: string }
  | { type: 'pairing_code'; code: string; expiresAt: number }
  | { type: 'phone_joined' }
  | { type: 'phone_left' }
  | { type: 'inbound'; text: string }
  | { type: 'stop' }
  | {
      type: 'paired';
      deviceId: string;
      deviceLabel: string;
      sessionToken: string;
    }
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: RemoteAskQuestion[] }
  | { type: 'hosts'; hosts: RemoteHostSummary[] }
  | { type: 'host_offline' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function questions(value: unknown): RemoteAskQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const out: RemoteAskQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as { question?: unknown; options?: unknown };
    const question = str(row.question);
    if (!question || !Array.isArray(row.options)) return null;
    const options: RemoteAskOption[] = [];
    for (const opt of row.options) {
      if (!opt || typeof opt !== 'object') return null;
      const label = str((opt as { label?: unknown }).label);
      if (!label) return null;
      const description = str((opt as { description?: unknown }).description);
      options.push(description ? { label, description } : { label });
    }
    if (options.length === 0) return null;
    out.push({ question, options });
  }
  return out;
}

export function parseRemoteClientMessage(raw: string): RemoteClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;
  const msg = parsed as { type?: unknown };
  if (msg.type === 'ping') return { type: 'ping' };
  if (msg.type === 'host_pair') return { type: 'host_pair' };
  if (msg.type === 'stop') return { type: 'stop' };
  if (msg.type === 'host_register') {
    const deviceId = str((parsed as { deviceId?: unknown }).deviceId);
    const hostSecret = str((parsed as { hostSecret?: unknown }).hostSecret);
    const deviceLabel = str((parsed as { deviceLabel?: unknown }).deviceLabel);
    if (!deviceId || !hostSecret || !deviceLabel) return null;
    return { type: 'host_register', deviceId, hostSecret, deviceLabel };
  }
  if (msg.type === 'pair') {
    const code = str((parsed as { code?: unknown }).code).toUpperCase();
    if (!code) return null;
    return { type: 'pair', code };
  }
  if (msg.type === 'resume') {
    const sessionToken = str((parsed as { sessionToken?: unknown }).sessionToken);
    if (!sessionToken) return null;
    return { type: 'resume', sessionToken };
  }
  if (msg.type === 'list_hosts') {
    const raw = (parsed as { sessionTokens?: unknown }).sessionTokens;
    if (!Array.isArray(raw)) return null;
    const sessionTokens = raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 32);
    return { type: 'list_hosts', sessionTokens };
  }
  if (msg.type === 'prompt') {
    const text = str((parsed as { text?: unknown }).text);
    if (!text) return null;
    return { type: 'prompt', text };
  }
  if (msg.type === 'assistant') {
    return { type: 'assistant', text: str((parsed as { text?: unknown }).text) };
  }
  if (msg.type === 'ask_user') {
    const parsedQuestions = questions((parsed as { questions?: unknown }).questions);
    if (!parsedQuestions?.length) return null;
    return {
      type: 'ask_user',
      text: str((parsed as { text?: unknown }).text),
      questions: parsedQuestions,
    };
  }
  return null;
}

export function parseRemoteServerMessage(raw: string): RemoteServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  if (type === 'pong') return { type: 'pong' };
  if (type === 'phone_joined') return { type: 'phone_joined' };
  if (type === 'phone_left') return { type: 'phone_left' };
  if (type === 'host_offline') return { type: 'host_offline' };
  if (type === 'hosts') {
    const raw = (parsed as { hosts?: unknown }).hosts;
    if (!Array.isArray(raw)) return null;
    const hosts: RemoteHostSummary[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') return null;
      const row = item as { sessionToken?: unknown; deviceId?: unknown; deviceLabel?: unknown; online?: unknown };
      const sessionToken = str(row.sessionToken);
      if (!sessionToken || typeof row.deviceId !== 'string' || typeof row.deviceLabel !== 'string') return null;
      if (typeof row.online !== 'boolean') return null;
      hosts.push({
        sessionToken,
        deviceId: row.deviceId.trim(),
        deviceLabel: row.deviceLabel.trim(),
        online: row.online,
      });
    }
    return { type: 'hosts', hosts };
  }
  if (type === 'stop') return { type: 'stop' };
  if (type === 'registered') {
    const deviceId = str((parsed as { deviceId?: unknown }).deviceId);
    const deviceLabel = str((parsed as { deviceLabel?: unknown }).deviceLabel);
    if (!deviceId || !deviceLabel) return null;
    return { type: 'registered', deviceId, deviceLabel };
  }
  if (type === 'pairing_code') {
    const code = str((parsed as { code?: unknown }).code);
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
    if (!code || typeof expiresAt !== 'number') return null;
    return { type: 'pairing_code', code, expiresAt };
  }
  if (type === 'inbound') {
    const text = str((parsed as { text?: unknown }).text);
    if (!text) return null;
    return { type: 'inbound', text };
  }
  if (type === 'paired') {
    const deviceId = str((parsed as { deviceId?: unknown }).deviceId);
    const deviceLabel = str((parsed as { deviceLabel?: unknown }).deviceLabel);
    const sessionToken = str((parsed as { sessionToken?: unknown }).sessionToken);
    if (!deviceId || !deviceLabel || !sessionToken) return null;
    return { type: 'paired', deviceId, deviceLabel, sessionToken };
  }
  if (type === 'assistant') {
    return { type: 'assistant', text: str((parsed as { text?: unknown }).text) };
  }
  if (type === 'ask_user') {
    const parsedQuestions = questions((parsed as { questions?: unknown }).questions);
    if (!parsedQuestions?.length) return null;
    return {
      type: 'ask_user',
      text: str((parsed as { text?: unknown }).text),
      questions: parsedQuestions,
    };
  }
  if (type === 'error') {
    const message = str((parsed as { message?: unknown }).message) || 'remote error';
    return { type: 'error', message };
  }
  return null;
}
