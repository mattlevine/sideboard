import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BranchInfo } from '@sideboard-ai/core';
import { FloatingMenu } from './FloatingMenu';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  repoPath: string;
  currentBranch: string;
  disabled?: boolean;
  onSelect: (branch: string) => Promise<void>;
}

export function BranchPickerMenu({
  open,
  onClose,
  anchorRef,
  repoPath,
  currentBranch,
  disabled = false,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setError(null);
      setBusy(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.sideboard
      .listBranches(repoPath)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBranches([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoPath]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, loading]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? branches.filter((b) => b.name.toLowerCase().includes(q))
    : branches;

  return (
    <FloatingMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="left"
      minWidth={260}
      maxMenuHeight={360}
      className="branch-picker-menu"
    >
      <input
        ref={inputRef}
        className="branch-picker-search"
        placeholder="Switch branch…"
        value={query}
        disabled={disabled || Boolean(busy)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {loading ? (
        <div className="branch-picker-empty">Loading…</div>
      ) : error ? (
        <div className="branch-picker-empty">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="branch-picker-empty">No branches</div>
      ) : (
        filtered.map((b) => {
          const current = b.name === currentBranch || b.current;
          return (
            <button
              key={b.name}
              type="button"
              className={current ? 'selected' : ''}
              disabled={disabled || Boolean(busy) || current}
              onClick={() => {
                if (current) return;
                setBusy(b.name);
                void onSelect(b.name)
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : String(err));
                  })
                  .finally(() => setBusy(null));
              }}
            >
              <span className="menu-item-label">
                {b.name}
                {b.remote ? <span className="branch-picker-remote">origin</span> : null}
              </span>
              {busy === b.name ? <span className="thread-meta">…</span> : null}
            </button>
          );
        })
      )}
    </FloatingMenu>
  );
}
