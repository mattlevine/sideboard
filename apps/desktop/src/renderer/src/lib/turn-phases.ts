import type { MessagePart } from '@sideboard-ai/core';

type ThinkingPart = Extract<MessagePart, { type: 'thinking' }>;
type ToolPart = Extract<MessagePart, { type: 'tool' }>;
type TextPart = Extract<MessagePart, { type: 'text' }>;

export type TurnPhase =
  | { kind: 'thinking'; parts: ThinkingPart[] }
  | { kind: 'text'; text: string; parts: TextPart[] }
  | { kind: 'work'; parts: ToolPart[] };

export function isHiddenChatTool(name: string | undefined): boolean {
  const n = name ?? '';
  return /present_plan$/i.test(n) || /ask_user|AskUserQuestion/i.test(n);
}

function classify(part: MessagePart): 'thinking' | 'text' | 'work' | 'skip' {
  if (part.type === 'thinking') return part.text.trim() ? 'thinking' : 'skip';
  if (part.type === 'text') return part.text.trim() ? 'text' : 'skip';
  if (part.type === 'tool') {
    if (isHiddenChatTool(part.name)) return 'skip';
    return 'work';
  }
  return 'skip';
}

/** Group consecutive top-level parts into thought → text → work → text… */
export function splitTurnPhases(topParts: MessagePart[]): TurnPhase[] {
  const phases: TurnPhase[] = [];
  for (const part of topParts) {
    const kind = classify(part);
    if (kind === 'skip') continue;
    const last = phases[phases.length - 1];
    if (kind === 'thinking' && part.type === 'thinking') {
      if (last?.kind === 'thinking') last.parts.push(part);
      else phases.push({ kind: 'thinking', parts: [part] });
      continue;
    }
    if (kind === 'work' && part.type === 'tool') {
      if (last?.kind === 'work') last.parts.push(part);
      else phases.push({ kind: 'work', parts: [part] });
      continue;
    }
    if (part.type === 'text') {
      if (last?.kind === 'text') {
        last.text += part.text;
        last.parts.push(part);
      } else {
        phases.push({ kind: 'text', text: part.text, parts: [part] });
      }
    }
  }
  return phases.filter((p) => p.kind !== 'text' || p.text.trim());
}

export function phaseDurationMs(
  parts: ReadonlyArray<object>,
  opts?: { live?: boolean; now?: number },
): number | null {
  const timed = parts as Array<{ startedAt?: number; updatedAt?: number }>;
  const starts = timed
    .map((p) => p.startedAt)
    .filter((n): n is number => typeof n === 'number');
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const now = opts?.now ?? Date.now();
  if (opts?.live) return Math.max(0, now - start);
  const ends = timed
    .map((p) => p.updatedAt)
    .filter((n): n is number => typeof n === 'number');
  const end = ends.length ? Math.max(...ends) : now;
  return Math.max(0, end - start);
}
