export type OpenedMessage = { role: 'user' | 'agent'; text: string; streaming?: boolean };

export type OpenedBubble = { id: string; role: 'user' | 'agent'; text: string; streaming?: boolean };

/** Server snapshot for a chat the phone just opened. Replaces any cached bubbles. */
export function openedTranscript(
  chatId: string,
  messages: OpenedMessage[] | undefined,
  status: string | undefined,
): { bubbles: OpenedBubble[]; questions: null; working: boolean; activity: string } {
  const working = status === 'running' || status === 'queued';
  const bubbles = (Array.isArray(messages) ? messages : []).map((message, index) => ({
    id: `${chatId}-${index}`,
    role: message.role,
    text: message.text,
    ...(message.streaming ? { streaming: true as const } : {}),
  }));
  return { bubbles, questions: null, working, activity: '' };
}
