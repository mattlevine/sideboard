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

export function pushBubble(bubbles: OpenedBubble[], role: OpenedBubble['role'], text: string): OpenedBubble[] {
  if (!text.trim()) return bubbles;
  return [...bubbles, { id: `${Date.now()}-${bubbles.length}`, role, text }];
}

export function settleBubbles(bubbles: OpenedBubble[]): OpenedBubble[] {
  if (!bubbles.some((bubble) => bubble.streaming)) return bubbles;
  return bubbles.map((bubble) => (bubble.streaming ? { ...bubble, streaming: false } : bubble));
}

export function applyStream(
  current: { bubbles: OpenedBubble[]; questions: unknown; working: boolean; activity?: string },
  text: string,
  activity: string,
) {
  const bubbles = current.bubbles.slice();
  const trimmed = text.trim();
  if (trimmed) {
    const last = bubbles[bubbles.length - 1];
    if (last?.streaming) bubbles[bubbles.length - 1] = { ...last, text: trimmed };
    else bubbles.push({ id: `live-${Date.now()}-${bubbles.length}`, role: 'agent', text: trimmed, streaming: true });
  }
  return { ...current, bubbles, questions: null, working: true as const, activity };
}

export function finishAgent(bubbles: OpenedBubble[], text: string): OpenedBubble[] {
  const trimmed = text.trim();
  const last = bubbles[bubbles.length - 1];
  if (last?.streaming) {
    if (!trimmed) return bubbles.slice(0, -1);
    return [...bubbles.slice(0, -1), { ...last, text: trimmed, streaming: false }];
  }
  return pushBubble(bubbles, 'agent', trimmed);
}
