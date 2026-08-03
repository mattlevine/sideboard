import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Element to anchor against (button or wrapper). */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  /** Prefer aligning menu's left edge to anchor left (default). */
  align?: 'left' | 'right';
  /** Force direction, or auto-flip based on available space. */
  placement?: 'auto' | 'up' | 'down';
  minWidth?: number;
  /** Cap menu height (e.g. tool inspector should not eat the whole viewport). */
  maxMenuHeight?: number;
}

export function FloatingMenu({
  open,
  onClose,
  anchorRef,
  children,
  className = '',
  align = 'left',
  placement = 'auto',
  minWidth = 200,
  maxMenuHeight,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
    zIndex: 10000,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const place = () => {
      const menu = menuRef.current;
      if (!menu) return;

      const r = anchor.getBoundingClientRect();
      const pad = 8;
      const gap = 6;

      // Temporarily unconstrain to measure natural size
      menu.style.maxHeight = 'none';
      menu.style.height = 'auto';
      const naturalH = Math.max(menu.scrollHeight, 1);
      const naturalW = Math.max(menu.offsetWidth, minWidth);

      const spaceBelow = window.innerHeight - r.bottom - pad;
      const spaceAbove = r.top - pad;

      let openUp: boolean;
      if (placement === 'up') openUp = true;
      else if (placement === 'down') openUp = false;
      else openUp = spaceAbove >= spaceBelow || spaceBelow < Math.min(naturalH, 240);

      const spaceCap = Math.max(160, openUp ? spaceAbove - gap : spaceBelow - gap);
      const hardCap =
        typeof maxMenuHeight === 'number' && Number.isFinite(maxMenuHeight)
          ? Math.max(160, maxMenuHeight)
          : Number.POSITIVE_INFINITY;
      const maxH = Math.min(spaceCap, hardCap);
      const height = Math.min(naturalH, maxH);

      let left = align === 'right' ? r.right - naturalW : r.left;
      left = Math.max(pad, Math.min(left, window.innerWidth - naturalW - pad));

      const top = openUp ? Math.max(pad, r.top - height - gap) : r.bottom + gap;

      setStyle({
        position: 'fixed',
        top,
        left,
        width: naturalW,
        minWidth,
        height,
        maxHeight: maxH,
        zIndex: 10000,
        visibility: 'visible',
        overflow: 'hidden',
      });
    };

    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, align, placement, minWidth, maxMenuHeight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
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
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div ref={menuRef} className={`tool-menu floating-menu ${className}`.trim()} style={style}>
      {children}
    </div>,
    document.body,
  );
}
