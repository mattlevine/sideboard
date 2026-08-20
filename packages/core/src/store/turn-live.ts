import {
  existsSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import type { AgentEvent, MessagePart } from '../types/thread.js';
import { applyAgentEvent, toolDescription } from '../agents/message-parts.js';
import { threadLivePath } from './paths.js';

export interface TurnLiveProgress {
  updatedAt: string;
  /** One-line snapshot for coordinators (tools / thinking). */
  summary: string;
  lastTool?: string;
  toolCount: number;
  /** Last thinking or assistant excerpt (truncated). */
  excerpt?: string;
}

const buffers = new Map<
  string,
  { parts: MessagePart[]; timer: ReturnType<typeof setTimeout> | null }
>();

const FLUSH_MS = 800;
const MAX_PARTS = 80;

function trimParts(parts: MessagePart[]): MessagePart[] {
  if (parts.length <= MAX_PARTS) return parts;
  return parts.slice(-Math.floor(MAX_PARTS / 2));
}

function lastText(parts: MessagePart[], type: 'thinking' | 'text'): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === type && p.text.trim()) return p.text.trim();
  }
  return '';
}

export function summarizeTurnLive(parts: MessagePart[]): TurnLiveProgress {
  const tools = parts.filter(
    (p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool',
  );
  const lastTool = tools[tools.length - 1];
  const lastToolLabel = lastTool
    ? lastTool.description ||
      toolDescription(lastTool.name, lastTool.input) ||
      lastTool.name
    : undefined;
  const running = lastTool?.status === 'running';
  const thinking = lastText(parts, 'thinking');
  const text = lastText(parts, 'text');
  const excerptRaw = thinking || text;
  const excerpt =
    excerptRaw.length > 280 ? `${excerptRaw.slice(-280)}` : excerptRaw || undefined;

  let summary = 'Working…';
  if (lastToolLabel) {
    const verb = running ? lastToolLabel : `Finished ${lastToolLabel}`;
    summary =
      tools.length > 1 ? `${verb} (${tools.length} tools)` : verb;
  } else if (thinking) {
    summary = 'Thinking…';
  } else if (text) {
    summary = 'Writing reply…';
  }

  return {
    updatedAt: new Date().toISOString(),
    summary,
    lastTool: lastToolLabel,
    toolCount: tools.length,
    excerpt,
  };
}

function flush(threadId: string): void {
  const buf = buffers.get(threadId);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  writeTurnLive(threadId, summarizeTurnLive(buf.parts));
}

function scheduleFlush(threadId: string): void {
  const buf = buffers.get(threadId);
  if (!buf) return;
  if (buf.timer) return;
  buf.timer = setTimeout(() => {
    const live = buffers.get(threadId);
    if (live) live.timer = null;
    flush(threadId);
  }, FLUSH_MS);
}

/** Record a live agent event so MCP wait_for_turn can show progress. */
export function noteTurnLiveEvent(threadId: string, event: AgentEvent): void {
  if (
    event.type === 'session_id' ||
    event.type === 'usage' ||
    event.type === 'stderr'
  ) {
    return;
  }
  const prev = buffers.get(threadId) ?? { parts: [], timer: null };
  prev.parts = trimParts(applyAgentEvent(prev.parts, event));
  buffers.set(threadId, prev);
  if (event.type === 'exit') {
    flush(threadId);
    const cur = buffers.get(threadId);
    if (cur?.timer) clearTimeout(cur.timer);
    buffers.delete(threadId);
    return;
  }
  const immediate = event.type === 'tool_use' || event.type === 'tool_result';
  if (immediate) flush(threadId);
  else scheduleFlush(threadId);
}

export function writeTurnLive(
  threadId: string,
  progress: TurnLiveProgress,
): void {
  const path = threadLivePath(threadId);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(progress), 'utf8');
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export function readTurnLive(threadId: string): TurnLiveProgress | null {
  const path = threadLivePath(threadId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as TurnLiveProgress;
    if (!raw || typeof raw.summary !== 'string') return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearTurnLive(threadId: string): void {
  const buf = buffers.get(threadId);
  if (buf?.timer) clearTimeout(buf.timer);
  buffers.delete(threadId);
  const path = threadLivePath(threadId);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}
