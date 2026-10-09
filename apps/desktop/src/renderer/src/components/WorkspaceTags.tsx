import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { normalizeWorkspaceTags, WORKSPACE_TAG_LIMIT } from '@sideboard/worktree-labels';

/**
 * Compact chips for one workspace. Click a chip to filter. Extra tags stay
 * behind +N so the row does not grow. Editing happens in WorkspaceTagEditor.
 */
export function WorkspaceTags({
  tags,
  onFilter,
  onManage,
  board,
}: {
  tags: string[];
  onFilter?: (tag: string) => void;
  /** Sidebar: +N opens the editor instead of wrapping the row. */
  onManage?: () => void;
  /** Home card: show chips, no editor. */
  board?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  if (tags.length === 0) return null;

  const visibleLimit = 2;
  const canExpand = !onManage;
  const hiddenCount = canExpand && showAll ? 0 : Math.max(0, tags.length - visibleLimit);
  const visibleTags = hiddenCount > 0 ? tags.slice(0, visibleLimit) : tags;

  return (
    <div
      className={`workspace-tags${canExpand && showAll ? ' is-open' : ''}${board ? ' is-board' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {visibleTags.map((tag) => (
        <span key={tag.toLowerCase()} className="workspace-tag">
          {onFilter ? (
            <button
              type="button"
              className="workspace-tag-label"
              title={`Show workspaces tagged ${tag}`}
              onClick={() => onFilter(tag)}
            >
              {tag}
            </button>
          ) : (
            <span className="workspace-tag-label">{tag}</span>
          )}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="workspace-tag-more"
          title={onManage ? 'Edit tags' : `${hiddenCount} more tag${hiddenCount === 1 ? '' : 's'}`}
          onClick={() => (onManage ? onManage() : setShowAll(true))}
        >
          +{hiddenCount}
        </button>
      ) : null}
      {canExpand && showAll && tags.length > visibleLimit ? (
        <button type="button" className="workspace-tag-more" onClick={() => setShowAll(false)}>
          less
        </button>
      ) : null}
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
