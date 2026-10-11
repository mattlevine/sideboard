import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { normalizeWorkspaceTags, WORKSPACE_TAG_LIMIT } from '@sideboard/worktree-labels';

/**
 * Chips for one workspace. Every tag is listed and the row wraps.
 * Click a chip to filter. Editing happens in WorkspaceTagEditor.
 */
export function WorkspaceTags({
  tags,
  onFilter,
  selectedTags,
  board,
}: {
  tags: string[];
  onFilter?: (tag: string) => void;
  /** Tags currently included in the sidebar filter. */
  selectedTags?: string[];
  /** Home card: show chips, no editor. */
  board?: boolean;
}) {
  const selected = new Set((selectedTags ?? []).map((tag) => tag.toLowerCase()));

  if (tags.length === 0) return null;

  return (
    <div
      className={`workspace-tags${board ? ' is-board' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {tags.map((tag) => {
        const on = selected.has(tag.toLowerCase());
        const title = on
          ? `Stop filtering by ${tag}`
          : selected.size > 0
            ? `Also require ${tag}`
            : `Show workspaces tagged ${tag}`;
        return (
          <span key={tag.toLowerCase()} className={`workspace-tag${on ? ' is-selected' : ''}`}>
            {onFilter ? (
              <button
                type="button"
                className="workspace-tag-label"
                aria-pressed={on}
                title={title}
                onClick={() => onFilter(tag)}
              >
                {tag}
              </button>
            ) : (
              <span className="workspace-tag-label">{tag}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Small floating editor. Stays out of the sidebar flow so rows do not shift. */
export function WorkspaceTagEditor({
  open,
  tags,
  anchorRef,
  onChange,
  onClose,
}: {
  open: boolean;
  tags: string[];
  anchorRef: RefObject<HTMLElement | null>;
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef('');
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const atLimit = tags.length >= WORKSPACE_TAG_LIMIT;

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!open) {
      setDraft('');
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 220;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      let top = rect.bottom + 6;
      if (top + 160 > window.innerHeight - 8) {
        top = Math.max(8, rect.top - 166);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, tags.length]);

  function addDraft(raw: string) {
    const added = normalizeWorkspaceTags(raw);
    setDraft('');
    if (added.length === 0) return;
    onChange(normalizeWorkspaceTags([...tags, ...added]));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setDraft('');
      onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      const pending = draftRef.current;
      if (pending.trim()) {
        const added = normalizeWorkspaceTags(pending);
        if (added.length > 0) onChange(normalizeWorkspaceTags([...tags, ...added]));
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, onChange, tags, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="workspace-tag-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="Workspace tags"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="workspace-tag-popover-title">Tags</div>
      {tags.length === 0 ? (
        <div className="workspace-tag-popover-empty">No tags yet</div>
      ) : (
        <div className="workspace-tag-popover-list">
          {tags.map((tag) => (
            <span key={tag.toLowerCase()} className="workspace-tag">
              <span className="workspace-tag-label">{tag}</span>
              <button
                type="button"
                className="workspace-tag-remove"
                aria-label={`Remove tag ${tag}`}
                onClick={() =>
                  onChange(tags.filter((item) => item.toLowerCase() !== tag.toLowerCase()))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="workspace-tag-input"
        value={draft}
        autoFocus
        placeholder={atLimit ? `${WORKSPACE_TAG_LIMIT} tags max` : 'Add a tag'}
        aria-label="New tag"
        disabled={atLimit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addDraft(draft);
          }
        }}
      />
    </div>,
    document.body,
  );
}
