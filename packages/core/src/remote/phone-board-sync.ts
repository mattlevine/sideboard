import { basename } from 'node:path';
import { watch } from 'chokidar';
import type { OrchestratorEvent } from '../types/thread.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { appDataDir, threadsDir } from '../store/paths.js';
import { isThreadRecordFile } from '../store/thread-store.js';
import { listPhoneSidebar, type PhoneChatSummary, type PhoneSidebar } from './phone-chats.js';

/** Match the desktop thread watcher so a new worktree shows up without a refresh. */
export const PHONE_BOARD_SYNC_MS = 300;

function chatKey(row: PhoneChatSummary): string {
  return [row.id, row.title, row.status, row.agent, row.preview].join('\t');
}

/**
 * Identity of what the phone list renders. `updatedAt` is omitted so a
 * turn's bookkeeping writes do not push the whole sidebar.
 */
export function phoneBoardKey(sidebar: PhoneSidebar): string {
  const orchestration = sidebar.orchestration.map(chatKey).join('\n');
  const projects = sidebar.projects
    .map((project) => {
      const trees = project.worktrees
        .map((tree) => `${tree.label}\t${tree.chats.map(chatKey).join('\n')}`)
        .join('\n');
      return `${project.path}\t${project.name}\n${trees}`;
    })
    .join('\n---\n');
  return `${orchestration}\n===\n${projects}`;
}

export function isPhoneBoardEvent(event: OrchestratorEvent): boolean {
  return (
    event.type === 'status_changed' ||
    event.type === 'turn_started' ||
    event.type === 'turn_finished' ||
    event.type === 'queue_changed' ||
    event.type === 'error' ||
    event.type === 'context_compacted' ||
    event.type === 'quota_failover'
  );
}

function isRunningChat(
  event: OrchestratorEvent,
): event is Extract<OrchestratorEvent, { type: 'turn_started' | 'status_changed' }> {
  if (event.type === 'turn_started') return true;
  return (
    event.type === 'status_changed' && (event.status === 'running' || event.status === 'queued')
  );
}

/** Thread records and the workspace list. Live/setup sidecars are not records. */
export function subscribePhoneBoard(notify: () => void): () => void {
  const threads = watch(threadsDir(), { ignoreInitial: true, depth: 0 });
  const onThread = (changed: string) => {
    if (!isThreadRecordFile(changed)) return;
    notify();
  };
  threads.on('add', onThread);
  threads.on('change', onThread);
  threads.on('unlink', onThread);
  threads.on('error', () => undefined);

  const data = watch(appDataDir(), { ignoreInitial: true, depth: 0 });
  const onData = (changed: string) => {
    const name = basename(changed);
    if (name !== 'workspaces.json' && name !== 'removed-workspaces.json') return;
    notify();
  };
  data.on('add', onData);
  data.on('change', onData);
  data.on('unlink', onData);
  data.on('error', () => undefined);

  return () => {
    void threads.close();
    void data.close();
  };
}

export function startPhoneBoardSync(opts: {
  onSidebar: (sidebar: PhoneSidebar) => void;
  /** Desktop started a turn in the chat the phone has open. */
  onRunningChat?: (chatId: string) => void;
  openChatId?: () => string | null;
  debounceMs?: number;
  subscribe?: (notify: () => void) => () => void;
  events?: (listener: (event: OrchestratorEvent) => void) => () => void;
  list?: () => PhoneSidebar;
}): () => void {
  const list = opts.list ?? listPhoneSidebar;
  const debounceMs = opts.debounceMs ?? PHONE_BOARD_SYNC_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';
  let stopped = false;

  const push = () => {
    timer = null;
    if (stopped) return;
    let sidebar: PhoneSidebar;
    try {
      sidebar = list();
    } catch {
      return;
    }
    const key = phoneBoardKey(sidebar);
    if (key === lastKey) return;
    lastKey = key;
    opts.onSidebar(sidebar);
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, debounceMs);
  };

  const handle = (event: OrchestratorEvent) => {
    if (isPhoneBoardEvent(event)) schedule();
    if (!isRunningChat(event)) return;
    const open = opts.openChatId?.();
    if (open && open === event.threadId) opts.onRunningChat?.(event.threadId);
  };

  const unsubscribe = (opts.subscribe ?? subscribePhoneBoard)(schedule);
  const offEvents = (opts.events ?? ((listener) => getOrchestrator().on(listener)))(handle);
  push();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
    offEvents();
  };
}
