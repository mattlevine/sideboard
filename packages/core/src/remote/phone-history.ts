import type { Thread } from '../types/thread.js';
import { isGlobalThread } from '../store/global-workspace.js';
import { listThreads } from '../store/thread-store.js';
import type { PhoneHistoryPage } from './phone-chats.js';
import { clip, listPhoneMessages } from './phone-transcript.js';

const PREVIEW_LIMIT = 90;
const HISTORY_PAGE_SIZE = 40;

function previewOf(thread: Thread): string {
  const messages = listPhoneMessages(thread);
  const last = messages[messages.length - 1];
  if (!last) return '';
  return clip(last.text.replace(/\s+/g, ' ').trim(), PREVIEW_LIMIT);
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

function isProjectPath(path: string): boolean {
  if (!path || path === '/' || path === '.') return false;
  return !isGlobalThread({ repoPath: path });
}

function historyStamp(thread: Thread): string {
  return thread.archivedAt || thread.updatedAt;
}

function historyCursor(chat: { updatedAt: string; id: string }): string {
  return `${chat.updatedAt}\t${chat.id}`;
}

/** Settings → History: one page of archived chats, newest first. */
export function listPhoneHistory(opts?: { query?: string; after?: string }): PhoneHistoryPage {
  const query = opts?.query?.trim().toLowerCase() ?? '';
  const after = opts?.after?.trim() ?? '';
  const all = listThreads({ includeArchived: true })
    .filter((thread) => thread.status === 'archived')
    .filter((thread) => isGlobalThread(thread) || isProjectPath(thread.repoPath))
    .sort((a, b) => (historyStamp(a) < historyStamp(b) ? 1 : historyStamp(a) > historyStamp(b) ? -1 : 0))
    .map((thread) => ({
      id: thread.id,
      title: thread.title?.trim() || 'Untitled',
      preview: previewOf(thread),
      updatedAt: historyStamp(thread),
      where: isGlobalThread(thread) ? 'Orchestration' : repoName(thread.repoPath),
      agent: thread.agent,
    }))
    .filter((chat) => {
      if (!query) return true;
      return `${chat.title} ${chat.where} ${chat.agent} ${chat.preview}`.toLowerCase().includes(query);
    });
  let start = 0;
  if (after) {
    const index = all.findIndex((chat) => historyCursor(chat) === after);
    start = index >= 0 ? index + 1 : all.length;
  }
  const chats = all.slice(start, start + HISTORY_PAGE_SIZE);
  const last = chats.at(-1);
  const more = start + chats.length < all.length;
  return {
    chats,
    total: all.length,
    ...(more && last ? { next: historyCursor(last) } : {}),
  };
}
