import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

export interface PathRefTarget {
  path: string;
  kind: 'file' | 'dir';
}

export function AddReferenceButton({
  label,
  onAdd,
}: {
  label: string;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      className="add-ref-btn"
      title="Add reference to chat"
      aria-label={`Add reference to chat: ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAdd();
      }}
    >
      @
    </button>
  );
}

export function AddReferenceMenu({
  target,
  x,
  y,
  onAdd,
  onClose,
}: {
  target: PathRefTarget;
  x: number;
  y: number;
  onAdd: (target: PathRefTarget) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pad = 8;
  const left = Math.max(pad, Math.min(x, window.innerWidth - 220));
  const top = Math.max(pad, Math.min(y, window.innerHeight - 56));

  return createPortal(
    <div
      ref={ref}
      className="tool-menu floating-menu add-ref-menu"
      style={{ position: 'fixed', top, left, minWidth: 200, zIndex: 10000 }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAdd(target);
          onClose();
        }}
      >
        Add reference to chat
        <span className="add-ref-menu-path">{target.path}{target.kind === 'dir' ? '/' : ''}</span>
      </button>
    </div>,
    document.body,
  );
}

export function contextMenuTarget(
  e: ReactMouseEvent,
  target: PathRefTarget,
): { target: PathRefTarget; x: number; y: number } {
  e.preventDefault();
  e.stopPropagation();
  return { target, x: e.clientX, y: e.clientY };
}
