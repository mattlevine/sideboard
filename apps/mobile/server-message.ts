export type ServerMessage =
  | { type: 'paired'; deviceId: string; deviceLabel: string; sessionToken: string }
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: Array<{ question: string; options: Array<{ label: string; description?: string }> }> }
  | {
      type: 'hosts';
      hosts: Array<{ sessionToken: string; deviceId: string; deviceLabel: string; online: boolean }>;
    }
  | { type: 'host_offline' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export function parseServer(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}
