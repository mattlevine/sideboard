const EXPO_TOKEN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]{8,140}\]$/;
const HOSTED_RELAY = 'relay.sideboard.build';

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN.test(value);
}

/** Push is sent only by Sideboard's relay. A custom relay has no push key. */
export function hostedPushRelay(url: string): boolean {
  try {
    return new URL(url).hostname === HOSTED_RELAY;
  } catch {
    return false;
  }
}

export function sessionTokensForPush(
  desktops: Array<{ sessionToken: string; notify?: boolean }>,
): string[] {
  return desktops.filter((row) => row.notify !== false && row.sessionToken).map((row) => row.sessionToken);
}

export function parsePushData(data: unknown): { deviceId: string; chatId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as { deviceId?: unknown; chatId?: unknown };
  const deviceId = typeof row.deviceId === 'string' ? row.deviceId.trim() : '';
  const chatId = typeof row.chatId === 'string' ? row.chatId.trim() : '';
  if (!deviceId || !chatId) return null;
  return { deviceId, chatId };
}
