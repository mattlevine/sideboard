import { useEffect, useRef } from 'react';

interface Props {
  query: string;
  current: number;
  total: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function ChatSearchBar({
  query,
  current,
  total,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="chat-search-bar" role="search">
      <input
        ref={inputRef}
        type="text"
        className="chat-search-input"
        value={query}
        placeholder="Find in chat"
        aria-label="Find in chat"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
      />
      <span className="chat-search-count" aria-live="polite">
        {query.trim() ? (total ? `${current} / ${total}` : 'No matches') : ''}
      </span>
      <button type="button" className="chat-search-nav" title="Previous match" onClick={onPrev} disabled={!total}>
        ↑
      </button>
      <button type="button" className="chat-search-nav" title="Next match" onClick={onNext} disabled={!total}>
        ↓
      </button>
      <button type="button" className="chat-search-close" title="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
