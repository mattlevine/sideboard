import { useState } from 'react';
import { tintLine, type DiffRow } from '../lib/tool-diff';

function DiffLine({ row }: { row: Extract<DiffRow, { kind: 'context' | 'del' | 'add' }> }) {
  const tint = tintLine(row.text);
  return (
    <div className={`tool-diff-line ${row.kind}`}>
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
}

/** Cursor-style inline diff rows (shared by tool popovers + Changes pane). */
export function DiffLines({
  rows,
  className = 'tool-diff-body',
  emptyLabel = '(binary or empty patch)',
}: {
  rows: DiffRow[];
  className?: string;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (rows.length === 0) {
    return <div className="tool-diff-empty">{emptyLabel}</div>;
  }

  return (
    <div className={className}>
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
                row.rows.map((r, j) =>
                  r.kind === 'context' || r.kind === 'del' || r.kind === 'add' ? (
                    <DiffLine key={`${key}-${j}`} row={r} />
                  ) : null,
                )}
            </div>
          );
        }
        return <DiffLine key={`${row.kind}-${row.lineNo}-${i}`} row={row} />;
      })}
    </div>
  );
}
