import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import type { Thread } from '@sideboard-ai/core';
import { nestedChatDisplayTitle } from '../lib/nested-chat-title';
import { SIDEBAR_NEST_VISIBLE_ROWS } from '../lib/sidebar-chat-expand';
import { isChatUnread } from '../lib/unread-worktrees';
import {
  dropPlaceFromMidpoint,
  orderWorktreeChats,
  readWorktreeTabPrefs,
  reorderChatIds,
  SIDEBAR_CHAT_DRAG,
  writeWorktreeChatOrder,
} from '../lib/worktree-tabs';
import { AgentKindIcon } from './AgentKindIcon';
import { ThreadStatusIcon } from './ThreadStatusIcon';

export function WorktreeNestedChats({
  chats,
  worktreeKey,
  parentTitle,
  selectedId,
  active,
  multiSelected,
  onSelect,
  onMarkUnread,
  onRenameChat,
  onCloseChat,
}: {
  chats: Thread[];
  worktreeKey: string;
  parentTitle: string;
  selectedId: string | null;
  active: boolean;
  multiSelected: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onMarkUnread?: (thread: Thread) => void;
  onRenameChat?: (id: string, title: string) => void;
  onCloseChat?: (thread: Thread) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [order, setOrder] = useState<string[] | undefined>(
    () => readWorktreeTabPrefs(worktreeKey).chatOrder,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    place: 'before' | 'after';
  } | null>(null);
  const draggedId = useRef<string | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setOrder(readWorktreeTabPrefs(worktreeKey).chatOrder);
  }, [worktreeKey]);

  const ordered = orderWorktreeChats(chats, order);
  const canReorder = ordered.length > 1;

  function commitRename() {
    if (!editingId || !onRenameChat) {
      setEditingId(null);
      return;
    }
    const title = draft.trim();
    const current = chats.find((c) => c.id === editingId);
    const displayed = current
      ? nestedChatDisplayTitle(current, parentTitle)
      : '';
    if (title && title !== displayed) onRenameChat(editingId, title);
    setEditingId(null);
  }

  function dropPlace(el: HTMLElement, clientY: number): 'before' | 'after' {
    const rect = el.getBoundingClientRect();
    return dropPlaceFromMidpoint(clientY - rect.top, rect.height);
  }

  function onChatDragStart(e: DragEvent<HTMLDivElement>, id: string) {
    if (!canReorder || editingId === id) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    draggedId.current = id;
    suppressClick.current = false;
    setDraggingId(id);
    e.dataTransfer.setData(SIDEBAR_CHAT_DRAG, id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(e.currentTarget, 16, 12);
  }

  function onChatDragOver(e: DragEvent<HTMLDivElement>, id: string) {
    if (!canReorder) return;
    const from = draggedId.current;
    if (!from || from === id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const place = dropPlace(e.currentTarget, e.clientY);
    setDropHint((prev) =>
      prev?.id === id && prev.place === place ? prev : { id, place },
    );
  }

  function onChatDrop(e: DragEvent<HTMLDivElement>, targetId: string) {
    if (!canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    const fromId =
      e.dataTransfer.getData(SIDEBAR_CHAT_DRAG) ||
      e.dataTransfer.getData('text/plain') ||
      draggedId.current;
    const place = dropPlace(e.currentTarget, e.clientY);
    setDropHint(null);
    if (!fromId || fromId === targetId) return;
    const next = reorderChatIds(
      ordered.map((c) => c.id),
      fromId,
      targetId,
      place,
    );
    if (next.join('\0') === ordered.map((c) => c.id).join('\0')) return;
    suppressClick.current = true;
    writeWorktreeChatOrder(worktreeKey, next);
    setOrder(next);
  }

  function onChatDragEnd() {
    draggedId.current = null;
    setDraggingId(null);
    setDropHint(null);
  }

  return (
    <div
      className="worktree-chats"
      style={
        {
          '--nested-visible': SIDEBAR_NEST_VISIBLE_ROWS,
        } as CSSProperties
      }
    >
      {ordered.map((chat) => {
        const chatActive = active && chat.id === selectedId;
        const chatUnread = isChatUnread(chat, { active: chatActive });
        const renaming = editingId === chat.id;
        const chatTitle = nestedChatDisplayTitle(chat, parentTitle);
        const dragging = draggingId === chat.id;
        const dropClass =
          dropHint?.id === chat.id
            ? dropHint.place === 'before'
              ? ' drop-before'
              : ' drop-after'
            : '';
        return (
          <div
            key={chat.id}
            className={`thread-item nested${chatActive ? ' active' : ''}${
              multiSelected.size > 1 && multiSelected.has(chat.id)
                ? ' selected'
                : ''
            }${chatUnread ? ' unread' : ''}${
              canReorder && !renaming ? ' is-reorderable' : ''
            }${dragging ? ' is-dragging' : ''}${dropClass}`}
            draggable={canReorder && !renaming}
            onDragStart={(e) => onChatDragStart(e, chat.id)}
            onDragOver={(e) => onChatDragOver(e, chat.id)}
            onDrop={(e) => onChatDrop(e, chat.id)}
            onDragEnd={onChatDragEnd}
            onClick={(e) => {
              e.stopPropagation();
              if (renaming || suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onSelect(chat.id, e.metaKey || e.ctrlKey || e.shiftKey);
            }}
            onDoubleClick={(e) => {
              if (!onRenameChat) return;
              e.preventDefault();
              e.stopPropagation();
              setEditingId(chat.id);
              setDraft(chatTitle);
            }}
            onContextMenu={(e) => {
              if (!onMarkUnread) return;
              e.preventDefault();
              e.stopPropagation();
              onMarkUnread(chat);
            }}
          >
            <ThreadStatusIcon status={chat.status} unread={chatUnread} />
            <AgentKindIcon agent={chat.agent} />
            {renaming ? (
              <input
                className="nested-chat-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  }
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <span className="thread-title-text" title={chatTitle}>
                {chatTitle}
              </span>
            )}
            {onCloseChat ? (
              <button
                type="button"
                className="nested-chat-close"
                title="Close chat"
                aria-label={`Close ${chatTitle}`}
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseChat(chat);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
