import type { AgentEvent } from '../types/thread.js';

export type CodexStreamItem = {
  id?: string;
  type?: string;
  item_type?: string;
  text?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  status?: string;
};

/** Reasoning and file-change items. Other item types return null. */
export function eventsFromCodexItem(
  eventType: string,
  item: CodexStreamItem,
): AgentEvent | AgentEvent[] | null {
  const itemType = item.type ?? item.item_type;
  if (itemType === 'reasoning' && typeof item.text === 'string' && item.text) {
    return { type: 'thinking', data: item.text };
  }
  if (itemType !== 'file_change' || !item.id) return null;
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const paths = changes
    .map((change) => (typeof change?.path === 'string' ? change.path : ''))
    .filter(Boolean);
  const added = changes.some((change) => change?.kind === 'add');
  const events: AgentEvent[] = [
    {
      type: 'tool_use',
      id: item.id,
      name: added ? 'Write' : 'Edit',
      input: paths.length ? { paths } : undefined,
    },
  ];
  const finished =
    eventType === 'item.completed' || item.status === 'completed' || item.status === 'failed';
  if (finished) {
    events.push({
      type: 'tool_result',
      id: item.id,
      content: paths.join('\n') || undefined,
      isError: item.status === 'failed',
    });
  }
  return events.length === 1 ? events[0]! : events;
}
