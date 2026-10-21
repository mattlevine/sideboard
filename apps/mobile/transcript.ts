export type OpenedMessage = {
  role: 'user' | 'agent';
  text: string;
  streaming?: boolean;
  apps?: Array<{ id: string; tool: string }>;
};

export type OpenedBubble = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  streaming?: boolean;
  apps?: Array<{ id: string; tool: string }>;
};

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
    ...(message.apps?.length ? { apps: message.apps } : {}),
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

export function finishAgent(
  bubbles: OpenedBubble[],
  text: string,
  apps?: OpenedBubble['apps'],
): OpenedBubble[] {
  const trimmed = text.trim();
  const last = bubbles[bubbles.length - 1];
  const extra = apps?.length ? { apps } : {};
  if (last?.streaming) {
    if (!trimmed && !apps?.length) return bubbles.slice(0, -1);
    return [...bubbles.slice(0, -1), { ...last, text: trimmed, streaming: false, ...extra }];
  }
  if (!trimmed && apps?.length) {
    return [...bubbles, { id: `app-${bubbles.length}`, role: 'agent', text: '', apps }];
  }
  const next = pushBubble(bubbles, 'agent', trimmed);
  if (!apps?.length || next === bubbles) return next;
  const added = next[next.length - 1];
  if (!added) return next;
  return [...next.slice(0, -1), { ...added, apps }];
}

/** True when this empty ask is finishing a live turn, not reopening a picker. */
export function phoneAskIsLive(input: {
  working?: boolean;
  bubbles?: Array<{ streaming?: boolean }>;
  status?: string;
}): boolean {
  if (input.working) return true;
  if (input.bubbles?.some((bubble) => bubble.streaming)) return true;
  return input.status === 'running' || input.status === 'queued';
}

/** Sidebar patch for a finished assistant row or an ask. Empty ask text is a question refresh. */
export function phoneTurnPatch(
  op: 'assistant' | 'ask',
  text: string,
  opts?: { live?: boolean },
): { refreshQuestionsOnly: boolean; status?: 'idle'; preview?: string } {
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 90);
  if (op === 'ask' && !preview) {
    if (opts?.live) return { refreshQuestionsOnly: false, status: 'idle' };
    return { refreshQuestionsOnly: true };
  }
  return { refreshQuestionsOnly: false, status: 'idle', ...(preview ? { preview } : {}) };
}

/** Apply a finished turn. An ask with no text keeps the bubbles and preview. */
export function applyPhoneTurn<Q>(
  current: { bubbles: OpenedBubble[]; questions: Q | null; working: boolean; activity?: string },
  input: {
    op: 'assistant' | 'ask';
    text: string;
    apps?: OpenedBubble['apps'];
    questions?: Q | null;
  },
): { bubbles: OpenedBubble[]; questions: Q | null; working: boolean; activity: string } {
  if (input.op === 'ask' && !input.text.trim()) {
    return {
      bubbles: settleBubbles(current.bubbles),
      questions: input.questions ?? null,
      working: false,
      activity: '',
    };
  }
  return {
    bubbles: finishAgent(current.bubbles, input.text, input.op === 'assistant' ? input.apps : undefined),
    questions: input.op === 'ask' ? (input.questions ?? null) : null,
    working: false,
    activity: '',
  };
}
