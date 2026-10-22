import { useEffect, useRef, useState, type RefObject } from 'react';

/** Still "at the bottom" — new messages keep the transcript pinned. */
const CHAT_PIN_THRESHOLD_PX = 80;

const JUMP_CANCEL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

function chatIsPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_PIN_THRESHOLD_PX;
}

export function ChatJumpBottomButton({
  onClick,
  onWheel,
}: {
  onClick: () => void;
  onWheel: (deltaY: number, deltaX: number) => void;
}) {
  return (
    <button
      type="button"
      className="chat-jump-bottom"
      aria-label="Scroll to bottom"
      onClick={onClick}
      onWheel={(e) => onWheel(e.deltaY, e.deltaX)}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M3.5 6.25 8 10.75 12.5 6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * Pin the transcript to the latest message, and surface a jump control when
 * the user scrolls away. Arrow keys are listened for on `document` because
 * focus stays in the composer, which is not inside the transcript.
 */
export function useChatStickToBottom(input: {
  threadId: string;
  chatViewOpen: boolean;
  messages: unknown;
  queue: unknown;
  liveOutput: unknown;
  liveParts: unknown;
  pendingUser: string | null;
}): {
  chatRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: { current: boolean };
  awayFromBottom: boolean;
  scrollChatToLatest: () => void;
  scrollChatBy: (deltaY: number, deltaX: number) => void;
} {
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollJumpRef = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const { threadId, chatViewOpen, messages, queue, liveOutput, liveParts, pendingUser } = input;

  useEffect(() => {
    stickToBottomRef.current = true;
    scrollJumpRef.current = false;
    setAwayFromBottom(false);
  }, [threadId]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el || !chatViewOpen) return;
    const sync = () => {
      const pinned = chatIsPinnedToBottom(el);
      if (scrollJumpRef.current) {
        if (pinned) scrollJumpRef.current = false;
        else {
          stickToBottomRef.current = true;
          setAwayFromBottom(true);
          return;
        }
      }
      stickToBottomRef.current = pinned;
      setAwayFromBottom((away) => (away === !pinned ? away : !pinned));
    };
    const cancelJump = () => {
      if (!scrollJumpRef.current) return;
      scrollJumpRef.current = false;
      // Assigning scrollTop stops an in-flight smooth scroll at the current position.
      const top = el.scrollTop;
      el.scrollTop = top;
      const pinned = chatIsPinnedToBottom(el);
      stickToBottomRef.current = pinned;
      setAwayFromBottom((away) => (away === !pinned ? away : !pinned));
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (!JUMP_CANCEL_KEYS.has(event.key)) return;
      cancelJump();
    };
    // Remounting the transcript (file tab closed) resets scroll to the top.
    // If the user had unpinned, show the jump control without waiting for a scroll.
    if (!stickToBottomRef.current) sync();
    // Composer / queue height changes the viewport without a scroll event.
    // Stay pinned when we were following; otherwise refresh the jump button.
    const onResize = () => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
      sync();
    };
    const resize = new ResizeObserver(onResize);
    resize.observe(el);
    el.addEventListener('scroll', sync, { passive: true });
    el.addEventListener('wheel', cancelJump, { passive: true });
    el.addEventListener('pointerdown', cancelJump);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', sync);
      el.removeEventListener('wheel', cancelJump);
      el.removeEventListener('pointerdown', cancelJump);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
    };
  }, [threadId, chatViewOpen]);

  // Scroll only this chat's overflow container — never scrollIntoView (that
  // yanks shared ancestors when another thread's live chunks re-render App).
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, queue, liveOutput, liveParts, pendingUser, chatViewOpen]);

  function scrollChatToLatest() {
    const el = chatRef.current;
    if (!el) return;
    if (chatIsPinnedToBottom(el)) {
      scrollJumpRef.current = false;
      stickToBottomRef.current = true;
      setAwayFromBottom(false);
      return;
    }
    scrollJumpRef.current = true;
    stickToBottomRef.current = true;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }

  function scrollChatBy(deltaY: number, deltaX: number) {
    const el = chatRef.current;
    if (!el) return;
    if (scrollJumpRef.current) {
      scrollJumpRef.current = false;
      const top = el.scrollTop;
      el.scrollTop = top;
    }
    el.scrollBy({ top: deltaY, left: deltaX });
  }

  return { chatRef, stickToBottomRef, awayFromBottom, scrollChatToLatest, scrollChatBy };
}
