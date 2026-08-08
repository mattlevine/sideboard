import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Edge of the panel this handle sits on (`right` = left sidebar, `left` = right sidebar). */
  edge: 'left' | 'right';
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onChangeEnd?: (width: number) => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function PanelResizeHandle({
  edge,
  value,
  min,
  max,
  onChange,
  onChangeEnd,
}: Props) {
  const startX = useRef(0);
  const startW = useRef(0);
  const latest = useRef(value);
  const [dragging, setDragging] = useState(false);

  latest.current = value;

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX.current;
      const next =
        edge === 'right' ? startW.current + delta : startW.current - delta;
      onChange(clamp(Math.round(next), min, max));
    }

    function onUp() {
      setDragging(false);
      onChangeEnd?.(latest.current);
    }

    document.body.classList.add('resizing-panels');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, edge, min, max, onChange, onChangeEnd]);

  return (
    <>
      <div
        className={`panel-resize-handle edge-${edge}${dragging ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          startX.current = e.clientX;
          startW.current = value;
          setDragging(true);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 32 : 8;
          let next = value;
          if (e.key === 'ArrowLeft') {
            next = edge === 'right' ? value - step : value + step;
          } else if (e.key === 'ArrowRight') {
            next = edge === 'right' ? value + step : value - step;
          } else if (e.key === 'Home') {
            next = min;
          } else if (e.key === 'End') {
            next = max;
          } else {
            return;
          }
          e.preventDefault();
          const clamped = clamp(next, min, max);
          onChange(clamped);
          onChangeEnd?.(clamped);
        }}
      />
      {dragging
        ? createPortal(<div className="panel-resize-shield" aria-hidden />, document.body)
        : null}
    </>
  );
}
