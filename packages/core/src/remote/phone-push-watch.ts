import { getOrchestrator } from '../orchestrator/orchestrator.js';
import type { OrchestratorEvent } from '../types/thread.js';
import { isPhoneBoardEvent, subscribePhoneBoard } from './phone-board-sync.js';
import { listPhoneSidebar, type PhoneSidebar } from './phone-chats.js';
import { pushNotes, type PushKind } from './push.js';

export function needingChatIds(sidebar: PhoneSidebar): string[] {
  const ids: string[] = [];
  for (const chat of sidebar.orchestration) {
    if (chat.needsYou && chat.id) ids.push(chat.id);
  }
  for (const project of sidebar.projects) {
    for (const worktree of project.worktrees) {
      for (const chat of worktree.chats) {
        if (chat.needsYou && chat.id) ids.push(chat.id);
      }
    }
  }
  return ids;
}

/**
 * While this Mac is connected to Sideboard's relay, tell it when a chat
 * starts needing someone or a turn finishes. The relay drops a phone that
 * is already connected.
 */
export function startPhonePushWatch(opts: {
  enabled: () => boolean;
  send: (note: { chatId: string; kind: PushKind }) => void;
  needsYou?: () => string[];
  events?: (listener: (event: OrchestratorEvent) => void) => () => void;
  subscribe?: (notify: () => void) => () => void;
  debounceMs?: number;
}): () => void {
  const needsYou = opts.needsYou ?? (() => needingChatIds(listPhoneSidebar()));
  const read = () => new Set(needsYou());
  let needing = read();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (event: OrchestratorEvent | null) => {
    const after = read();
    if (!opts.enabled()) {
      needing = after;
      return;
    }
    for (const note of pushNotes({ event, before: needing, after })) opts.send(note);
    needing = after;
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush(null);
    }, opts.debounceMs ?? 300);
  };

  const onEvent = (event: OrchestratorEvent) => {
    if (event.type === 'turn_finished' || event.type === 'error') {
      if (timer) clearTimeout(timer);
      timer = null;
      flush(event);
      return;
    }
    if (isPhoneBoardEvent(event)) schedule();
  };

  const offEvents = (opts.events ?? ((listener) => getOrchestrator().on(listener)))(onEvent);
  const offFiles = (opts.subscribe ?? subscribePhoneBoard)(() => schedule());
  return () => {
    if (timer) clearTimeout(timer);
    offEvents();
    offFiles();
  };
}
