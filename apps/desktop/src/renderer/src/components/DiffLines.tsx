import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { DiffCommentLine } from '@sideboard/diff-comment';
import { tintLine, type DiffRow } from '../lib/tool-diff';

type SelectableRow = Extract<DiffRow, { kind: 'context' | 'del' | 'add' }>;

const DiffLine = memo(function DiffLine({
  row,
  selected,
  commentable,
  index,
}: {
  row: SelectableRow;
  selected: boolean;
  commentable: boolean;
  index: number;
}) {
  const tint = tintLine(row.text);
  return (
    <div
      className={`tool-diff-line ${row.kind}${selected ? ' selected' : ''}${commentable ? ' commentable' : ''}`}
      data-diff-idx={commentable ? String(index) : undefined}
    >
      <span className="tool-diff-gutter" aria-hidden />
      <span className="tool-diff-lineno">{row.lineNo}</span>
      <span className="tool-diff-code">
        {tint.comment != null ? (
          <span className="tok-comment">{tint.comment}</span>
        ) : tint.key != null ? (
          <>
            <span className="tok-key">{tint.key}</span>
            <span className="tok-value">{tint.value}</span>
          </>
        ) : (
          tint.plain
        )}
      </span>
    </div>
  );
});

function flattenSelectable(rows: DiffRow[], expanded: Record<string, boolean>): SelectableRow[] {
  const out: SelectableRow[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'collapse') {
      const key = `${row.direction}-${i}`;
      if (expanded[key]) {
        for (const r of row.rows) {
          if (r.kind === 'context' || r.kind === 'del' || r.kind === 'add') out.push(r);
        }
      }
      return;
    }
    out.push(row);
  });
  return out;
}

export interface DiffCommentSubmit {
  lines: DiffCommentLine[];
  comment: string;
}

/** Cursor-style inline diff rows (shared by tool popovers + Changes pane). */
export function DiffLines({
  rows,
  className = 'tool-diff-body',
  emptyLabel = '(binary or empty patch)',
  commentable = false,
  onSubmitComment,
}: {
  rows: DiffRow[];
  className?: string;
  emptyLabel?: string;
  /** Enable click/shift-click line selection + comment → composer. */
  commentable?: boolean;
  onSubmitComment?: (payload: DiffCommentSubmit) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLTextAreaElement>(null);

  const selectable = useMemo(
    () => flattenSelectable(rows, expanded),
    [rows, expanded],
  );

  const selectedRange = useMemo(() => {
    if (anchor == null || focus == null) return null;
    const lo = Math.min(anchor, focus);
    const hi = Math.max(anchor, focus);
    return { lo, hi };
  }, [anchor, focus]);

  const selectedLines = useMemo(() => {
    if (!selectedRange) return [];
    return selectable.slice(selectedRange.lo, selectedRange.hi + 1);
  }, [selectable, selectedRange]);

  useEffect(() => {
    if (selectedLines.length > 0) {
      requestAnimationFrame(() => formRef.current?.focus());
    }
  }, [selectedLines.length]);

  useEffect(() => {
    if (!commentable) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && (anchor != null || draft)) {
        e.preventDefault();
        setAnchor(null);
        setFocus(null);
        setDraft('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commentable, anchor, draft]);

  function selectAt(index: number, shiftKey: boolean) {
    if (!commentable) return;
    if (shiftKey && anchor != null) {
      setFocus(index);
    } else {
      setAnchor(index);
      setFocus(index);
    }
  }

  function onBodyClick(e: MouseEvent<HTMLDivElement>) {
    if (!commentable) return;
    const el = (e.target as HTMLElement | null)?.closest('[data-diff-idx]');
    if (!el) return;
    const idx = Number(el.getAttribute('data-diff-idx'));
    if (!Number.isFinite(idx)) return;
    selectAt(idx, e.shiftKey);
  }

  function clearSelection() {
    setAnchor(null);
    setFocus(null);
    setDraft('');
  }

  function submit() {
    const comment = draft.trim();
    if (!comment || selectedLines.length === 0 || !onSubmitComment || submitting) return;
    setSubmitting(true);
    try {
      onSubmitComment({
        comment,
        lines: selectedLines.map((r) => ({
          side: r.kind,
          lineNo: r.lineNo,
          text: r.text,
        })),
      });
      clearSelection();
    } finally {
      setSubmitting(false);
    }
  }

  if (rows.length === 0) {
    return <div className="tool-diff-empty">{emptyLabel}</div>;
  }

  let selectCursor = 0;

  return (
    <div
      className={`${className}${commentable ? ' is-commentable' : ''}`}
      onClick={commentable ? onBodyClick : undefined}
    >
      {commentable && (
        <div className="diff-comment-hint thread-meta">
          Click a line to comment · Shift-click for a range · Esc to clear
        </div>
      )}
      {rows.map((row, i) => {
        if (row.kind === 'collapse') {
          const key = `${row.direction}-${i}`;
          const open = expanded[key];
          return (
            <div key={key}>
              <button
                type="button"
                className="tool-diff-collapse"
                onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))}
              >
                <span className="tool-diff-collapse-chevron">
                  {row.direction === 'up' ? '▴' : '▾'}
                </span>
                {row.count} unmodified line{row.count === 1 ? '' : 's'}
              </button>
              {open &&
                row.rows.map((r, j) => {
                  if (r.kind !== 'context' && r.kind !== 'del' && r.kind !== 'add') return null;
                  const idx = selectCursor++;
                  const selected =
                    selectedRange != null && idx >= selectedRange.lo && idx <= selectedRange.hi;
                  return (
                    <DiffLine
                      key={`${key}-${j}`}
                      row={r}
                      selected={selected}
                      commentable={commentable}
                      index={idx}
                    />
                  );
                })}
            </div>
          );
        }

        const idx = selectCursor++;
        const selected =
          selectedRange != null && idx >= selectedRange.lo && idx <= selectedRange.hi;
        return (
          <DiffLine
            key={`${row.kind}-${row.lineNo}-${i}`}
            row={row}
            selected={selected}
            commentable={commentable}
            index={idx}
          />
        );
      })}

      {commentable && selectedLines.length > 0 && (
        <div className="diff-comment-form">
          <div className="diff-comment-form-meta thread-meta">
            Commenting on{' '}
            {selectedLines.length === 1
              ? `line ${selectedLines[0]!.lineNo}`
              : `lines ${selectedLines[0]!.lineNo}–${selectedLines[selectedLines.length - 1]!.lineNo}`}
            {' · '}
            {selectedLines.length} line{selectedLines.length === 1 ? '' : 's'}
          </div>
          <textarea
            ref={formRef}
            className="diff-comment-textarea"
            placeholder="Ask the agent to fix or explain these lines…"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              e.stopPropagation();
            }}
          />
          <div className="diff-comment-actions">
            <button type="button" onClick={clearSelection} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={!draft.trim() || submitting}
              onClick={submit}
            >
              Add to chat ⌘↵
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
