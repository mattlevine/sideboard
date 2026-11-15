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
